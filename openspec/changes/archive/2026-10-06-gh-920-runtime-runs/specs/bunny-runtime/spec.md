## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, which may be empty, and SHALL NOT load modules any other way. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.0`, positive memory figures and no modules

#### Scenario: Another route
- **WHEN** a client sends GET to `/`, POST to the health path, GET with a query string or GET to another version's path
- **THEN** each answers 404 with `{"error": {"code": "not-found", "retryable": false, "detail": "no such route"}}`

#### Scenario: A request that does not name the listener
- **WHEN** a request names another host, omits the port, carries an `Origin`, or carries `Sec-Fetch-Site` `cross-site` or `same-origin`
- **THEN** it answers 403 with `forbidden`, as does one naming another port, while requests naming `127.0.0.1:<port>` or `localhost:<port>` in any letter case, with or without `Sec-Fetch-Site` `none`, answer 200

#### Scenario: Sync restarts in health
- **WHEN** a module's sync copy overflows a buffer of one while its handler is stalled, and restarts its sync
- **THEN** that module's health entry counts one sync restart, another module counts none, and the module keeps running

#### Scenario: Stopping
- **WHEN** the runtime stops, and stops again
- **THEN** the health server no longer accepts connections, and the second stop resolves

#### Scenario: The shipped process
- **WHEN** the shipped entry point runs with `--port 0` and a private state directory
- **THEN** it writes a `runtime.ready` line with its URL, health lists no modules, and SIGTERM stops it with exit status 0

#### Scenario: A signal while the runtime loads
- **WHEN** SIGTERM or SIGINT arrives while the entry point still loads the runtime, whether loading turns the event loop or blocks it
- **THEN** the process exits 0 with no ready line, and the state directory was never created

#### Scenario: The entry point loads through its launcher
- **WHEN** the built entry point is read
- **THEN** its only static import is the launcher

#### Scenario: A signal during startup
- **WHEN** SIGTERM or SIGINT arrives while a module's start is still running
- **THEN** the process stops that module once its start settles, writes no ready line and exits 0

#### Scenario: Malformed arguments
- **WHEN** the entry point runs without `--port`, with a port that is not an integer from 0 to 65535, a lag limit that is not a positive integer or an unknown option
- **THEN** it exits with status 2 and a usage line

## ADDED Requirements

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one; with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve the SDK's remote transport (`RemoteEdge`, #883) on its health listener under `/api/sdk/v1/`, on the modules' bus, under the same local-request rules as health. The edge SHALL serve only once every module's start has settled; until then its routes SHALL answer 503 with `unavailable`. Its grants SHALL come from `edge-grants.json` in the state directory, `{"schema": "edge-grants/1.0", "grants": [{source, token}]}`: a private file (mode 600, one link, owned by the runtime's user) never reached through a link, with at least one grant, well-formed sources, tokens of 32 to 512 characters without spaces, and no token shared. A grant whose source is the core's (`bunny/core`) or a module's (`bunny/modules/<name>`) SHALL be refused, so no remote part can publish as either. The runtime SHALL refuse to start, before it serves, with `edge-grants-missing`, `edge-grants-not-private`, `edge-grants-invalid` or `edge-grant-source` as the `runtime.failed` record's `error.code`. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. The `runtime.started` record SHALL say whether modules are simulated and whether the edge serves. Stopping the runtime SHALL close the edge before it stops the modules.

#### Scenario: A remote part with a grant
- **WHEN** the runtime runs with an edge, the stand-in core and a grant for `bunny/parts/reader`
- **THEN** a remote part with that grant connects and syncs the core's sessions, one with another token is `unauthenticated`, a call without a token answers 401, the edge's connection is logged with its source, and no token appears in a log record

#### Scenario: Before the modules have started
- **WHEN** a remote part opens its stream while a module's start is still running
- **THEN** the edge answers 503 with `unavailable`, and the same stream connects once the start settles; a request with a browser `Origin` answers 403

#### Scenario: A grants file the runtime refuses
- **WHEN** the grants file is missing, has mode 644, is a symbolic link or a second hard link, is not JSON, names another schema, lists no grant, has a short token, a malformed source or a token two grants share
- **THEN** the runtime refuses to start with `edge-grants-missing`, `edge-grants-not-private` or `edge-grants-invalid`, and the refusal never quotes a token

#### Scenario: A grant that acts as the core or a module
- **WHEN** a grant names `bunny/core`, `bunny/modules/lamp` or `bunny/modules/core`, through `startRuntime` or the shipped entry point with `--edge`
- **THEN** the runtime refuses to start with `edge-grant-source`, which the entry point names in `runtime.failed` with exit status 1 and no ready line

#### Scenario: Simulated modules
- **WHEN** the shipped entry point runs with `--simulate` and `--edge` and a private grants file
- **THEN** a remote part with a run grant reaches its edge, the `runtime.started` record says the modules are simulated and the edge serves, SIGTERM stops it with exit status 0, and each module factory builds its simulated module under `--simulate` and its real one otherwise

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge` and the run's state directory: with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The run's grants SHALL be generated per run, one per part, into the state directory's grants file, and never printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, and its simulated devices SHALL keep their state; a child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, arm a crash between the lamp's commit and its publish, lose an acknowledgment, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` (a guard refuses every outbound TCP connection of the runtime before it is made) and `private-state` SHALL fail the start when a run crosses the boundary, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only.

#### Scenario: Start, capture and stop
- **WHEN** a reviewer starts a run with the fixture modules, captures a catalog scenario, reseeds it to `zero-modules` and captures that scenario, then stops it
- **THEN** each capture passes, `doctor` reports every check passed and both listeners where the receipt says, and `stop` removes the unit, its lease timer and its runtime directory and closes both ports, while proof stays in the proof root and no grant appears in a result, card or receipt

#### Scenario: Every catalog scenario in a run
- **WHEN** each catalog scenario's capture step runs on a freshly seeded run without a user manager
- **THEN** every step passes, attaches its scenario result and asserts the boundaries, the `edge-grants` step syncs with the reader's grant and gets `unauthenticated` without one, and the negative control fails

#### Scenario: A crash in a run
- **WHEN** a crash is armed and a remote part switches the lamp
- **THEN** the remote part's request ends `uncertain-result`, the runtime starts again on the same port, the lamp's outbox republishes its three messages, and the simulated lamp keeps the state it reached

#### Scenario: Boundary crossed
- **WHEN** a run starts the shipped runtime without `--simulate`, a probe module that reaches for the installed Hub's port 8788, or the runtime without `--state-dir`
- **THEN** exactly the matching check fails, naming the crossing; the guard refuses the probe before it connects, and the runtime's default state directory lies under the run's private home

#### Scenario: Negative control on a running run
- **WHEN** a reviewer asks a running run to reseed into a boundary negative control
- **THEN** the command is refused with `start-only-scenario` and exit status 2 before anything changes

#### Scenario: Process cleanup
- **WHEN** a run's supervisor is stopped, or killed
- **THEN** its runtime child is gone and both ports are closed; a killed supervisor's child stops itself
