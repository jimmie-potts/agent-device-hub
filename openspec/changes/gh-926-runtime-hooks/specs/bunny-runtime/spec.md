## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`), the LIFX module (`lifx-module`, Hub #928), the Tidbyt module (`runtime-tidbyt`, Hub #930) and the Codex Desktop module (`runtime-codex-desktop`, Hub #926) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts, `serves` with the families it serves through sync while it serves any (Hub #967), and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port; a health request SHALL also carry no `Origin` and no `Sec-Fetch-Site` other than `none`. Any other request SHALL answer 403 with the shared error body and code `forbidden`. Without an edge, every other method, path or query SHALL answer 404 with the shared error body and code `not-found`; with one, the gateway SHALL serve every other route (see "Simulated modules and the SDK edge" and "Runtime gateway callers"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.2`, positive memory figures and no modules

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running at module API `1.2` and each shipped device module, the playback, LIFX, Tidbyt and Codex Desktop modules, at the module API version each declares, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

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

### Requirement: Agent hooks and Codex Desktop in the catalog and disposable runs

The harness contract SHALL include a `hook` call that runs the 2.0 hook script (`runtime-agent-hooks`) once, as a client's hook command does, with an unchanged lifecycle 1.x producer file naming the runtime's port and a payload on stdin, and that, asked with `runtime: 'stopped'`, runs it while the runtime is stopped and starts the runtime again on the same state directory and port afterwards. Each execution adapter SHALL grant the agent hooks' converted producer credential (`PRODUCER`, with `ingest` alone, under a run-generated token in the Hub's form with the synthetic prefix `tok_SYNTHETIC835`) beside the parts' credentials, and its `gateway` call SHALL also act as that producer. The hook's environment SHALL carry no Claude Code variable and no `CODEX_HOME` of the process that runs it. The catalog SHALL also cover the agent hooks through the 2.0 hook script and the Codex Desktop module with a simulated marker (`runtime-codex-desktop`). In a disposable run the supervisor SHALL write the producer file once it knows the runtime's port, at `<data>/config/producer/producer.json`, owner-only; its harness API SHALL drive the simulated marker, and its restart SHALL take an optional `holdMs`, a whole number of milliseconds up to 10,000, for which it keeps the runtime stopped before it starts it again; the runtime's child SHALL reach the simulated marker over its IPC channel without a path; and the served candidate SHALL include the hook script and the module's build, whose sources `build-current` watches.

#### Scenario: Agent hooks on both transports and in a run
- **WHEN** `agent-hooks` runs in process, through the edge and in a disposable run: the hook script reports a Claude Code session's start, a prompt with a private canary, a permission dialog, the tool that ends it and the turn's end; the producer's credential sends a command and reads; a hook runs while the runtime is stopped; and the next hook runs after the restart
- **THEN** each hook exits 0 within 3 s and writes nothing; the session appears with its project, holds the turn, raises the approval prompt and clears it as resolved, and ends idle with its notice; the producer's command and read are `forbidden` and its authority is `ingest`; the hook while the runtime is stopped is lost, so after the restart the session keeps its turn and is uncertain, until the next hook makes it current on the new turn; and no record, message or answer holds the canary or a token

#### Scenario: Codex Desktop's marker on both transports and in a run
- **WHEN** `codex-desktop-read` runs in process, through the edge and in a disposable run
- **THEN** it passes as `runtime-codex-desktop` "Simulated marker and acceptance tiers" requires, and every message the parts see follows profile 2.0
