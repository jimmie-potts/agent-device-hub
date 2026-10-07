## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`), the LIFX module (`lifx-module`, Hub #928), the Tidbyt module (`runtime-tidbyt`, Hub #930) and the Pixoo module (`bunny-pixoo-module`, Hub #843) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts, `serves` with the families it serves through sync while it serves any (Hub #967), and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port; a health request SHALL also carry no `Origin` and no `Sec-Fetch-Site` other than `none`. Any other request SHALL answer 403 with the shared error body and code `forbidden`. Without an edge, every other method, path or query SHALL answer 404 with the shared error body and code `not-found`; with one, the gateway SHALL serve every other route (see "Simulated modules and the SDK edge" and "Runtime gateway callers"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running at module API `1.2` and each shipped device module, the playback, LIFX, Tidbyt and Pixoo modules, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

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

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and the edge's section with a credentials file that grants each part the catalog's `GRANTS` under a run-generated token's digest, and SHALL start the runtime with it. The harness contract SHALL include a `gateway` call that reaches the runtime's gateway over HTTP, on both transports, as a part with its token, as a browser that a trusted loopback page signed in, as a stranger with a made-up token, or with neither. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL mount the runtime's gateway on 127.0.0.1 for each runtime it starts, and SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through the gateway's SDK edge with a run-generated credential per part, whose grant the edge enforces. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, the Tidbyt module showing agent status and what plays on a simulated cloud with each tile behind its 15-second gate, the gateway's reads and refusals, a token outside its grant refused and a command sent again refused as a duplicate, an operator's approval recovery after a restart, a module's page, content, settings and MCP tool, Pixoo's Monitor following the core's sessions, a media command to the Pixoo accepted then completed once the media reached it, a Now Playing card for the playback module's presented speaker over Monitor and in a whole takeover of Media while the song plays on unchanged, the Pixoo starting while its device is offline and recovering once it answers, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:runtime:scenarios` runs
- **THEN** every catalog scenario passes in process and through the edge, every part reached the runtime through the edge in the remote run, and no message broke profile 2.0

#### Scenario: A duplicate, a disconnect and a crash on both transports
- **WHEN** the end-to-end scenario sends a command twice with one `requestId`, sends one the lamp cannot carry out, disconnects the reader while the lamp switches, crashes the runtime between the lamp's commit and its publish, and loses the core's acknowledgment of a later outcome
- **THEN** history holds one outcome for the duplicate and the device switched once; the failed command's inbox row reaches the reader and survives the restart; the reader syncs again and hears nothing published while it was away; at the restart the lamp republishes its state, occurrence and outcome once, history takes the outcome once and the lamp receives no command; an outcome whose acknowledgment was lost goes out again at the next clean restart, the core takes it as a duplicate, acknowledges it again and keeps one history entry, and the restart after that republishes nothing

#### Scenario: A failed step
- **WHEN** an expectation never holds, an action throws or a held observation breaks
- **THEN** the scenario fails at that step with what it observed, and runs no later step

#### Scenario: Boundaries
- **WHEN** a harness starts
- **THEN** its edge listens on 127.0.0.1 on a port outside the installed services' ports, its state directory is mode 700 and removed afterwards, a state directory inside a Git checkout is refused with `state-dir-checkout`, and its tokens are unique and appear in no log record, edge record or message

#### Scenario: The agent-session core alone
- **WHEN** the core runs with no device module, a hook observes two sessions, an approval prompt raised and resolved, a turn's end and one session's runtime end, the panel acknowledges the finished turn's notice and the operator tries to acknowledge it as the panel, and the runtime restarts
- **THEN** on both transports the reader holds both sessions, hears `attention.raised`, `attention.cleared` with cause `resolved`, `turn.ended` naming the notice and `session.ended`; the finished turn stays on the session record as an unread notice and never becomes an inbox item; the notice is acknowledged by the panel only and the operator's attempt is `forbidden`; and after the restart the session is uncertain until a new turn's evidence makes it current

#### Scenario: An unexpected refusal
- **WHEN** the in-memory harness starts the misconfigured-module seed without its expected refusal, and then with it
- **THEN** the first start fails because the runtime did not start, and the second starts

#### Scenario: Configured modules on both transports
- **WHEN** the configured-module and misconfigured-module scenarios run in process and through the edge
- **THEN** the sign runs while its sign is offline, reports it `unavailable`, then `available` with the greeting shown and no token refused; with an invalid section the sign is `refused` with `invalid-request`, never reaches its sign, and the core still commits a session the reader holds; and in both, no log record, published message, health entry or reader copy holds the synthetic token

#### Scenario: Playback on both transports
- **WHEN** the speaker-playback scenario runs in process and through the edge: the phone plays to the HT-A9, the operator pauses, the phone switches AirPlay to the Move, the operator pauses again, the Move stops answering and answers again, and the Move never answers a later command, which the operator sends twice
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token; a playback command whose subject names another speaker than its key is `invalid-message`; and the reader, whose grant may only read, is refused a playback command with `forbidden`

#### Scenario: The Tidbyt's tiles
- **WHEN** the tidbyt-tiles scenario runs in process and through the edge: the runtime starts with no session and nothing playing over AirPlay, the hook observes a session start and a turn, then an approval prompt, its answer and a second prompt inside the gate, and the phone plays a song to the Move; once the song's card has stood past its gate, the runtime restarts cleanly with the Move answering each call 400 ms late, after the HT-A9; then the phone pauses the song and stops it
- **THEN** the idle start writes nothing to the simulated cloud; the status tile shows the frame the reader's sessions call for, and the burst makes one later push of the latest state, at least 15 seconds after the first; the now-playing tile shows the song's card, which the restart neither removes nor pushes again while the playback record waits for the Move's first read, then the pause marker, behind its own gate, and leaves the rotation when the music stops; after the restart the status tile is pushed again with its session dimmed as uncertain; the reader holds the Tidbyt's device record from `bunny/modules/tidbyt` with no control; and neither the API key nor the cloud device appears in a log record, message, health entry or reader copy

#### Scenario: The gateway on both transports
- **WHEN** the gateway-reads, grants-and-duplicates, approval-recovery and module-contributions scenarios run in process and through the edge
- **THEN** a part reads sessions on `/api/v2`, through the snapshot read API and through the `core_sessions` MCP tool; a malformed family is `invalid-request`, an unknown one `not-found`, a made-up or missing token `unauthenticated`, a credential or browser session used from another site and a hook reading `forbidden`, and a route of the old Hub `not-found`, logged with its route; a hook's and a reader's command are `forbidden` and switch nothing, a command whose subject names another lamp than its key is `invalid-message`, and a hook's moment occurrence on a lifecycle key is `forbidden` and heard by nobody; a raw command sent again is `duplicate-conflict` and the lamp runs it once; the hook's recovery is `forbidden`, a stale revision `revision-conflict`, and the operator's recovery clears the approval with cause `recovered`; the sign's page, preview, settings and tool are served, the page without a session is `unauthenticated`, and the hook, which may not read, is refused the settings with `forbidden`; and no log record, message, health entry or answer holds a part's token

#### Scenario: The Pixoo on both transports
- **WHEN** the four Pixoo scenarios run in process and through the edge, with a simulated Pixoo and the playback module's simulated speakers
- **THEN** the Pixoo shows the waiting session's two-frame dashboard and then a calm one; an import, a playlist and a start complete, the start accepted at once and completed `transmitted` once the Pixoo shows the media; the presented speaker's song pops up as a card over Monitor for ten seconds without dimming, and while it plays on unchanged a whole takeover in Media keeps its current card for more than 30 s, until the song stops; and after a restart while the device is offline the module runs with the device `unavailable`, logs one degradation and one recovery, and the device is `available` once it answers

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans`, the run's state directory and `--config` with the configuration file the seed wrote under `<data>/config`, owner-only: each configured module's section with token files holding only the synthetic token, or for the shipped run each shipped module's simulated section, and the edge's section with a trusted loopback sign-in, MCP on and the launcher off, since the run's state directory is too deep for its socket. It runs with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The simulated Pixoo SHALL live in the child beside the module that reaches it: the child SHALL report what the Pixoo shows to the supervisor, which SHALL report it with the other devices and start each new child's Pixoo in the mode last set, showing what the last child's Pixoo showed. Each part's credential SHALL be generated per run, with the catalog's grant, into the owner-only credentials file the configuration names, which holds only digests; the parts' tokens, which carry the synthetic prefix `tok_SYNTHETIC835`, SHALL go to an owner-only file of their own for the run adapter, and SHALL never be printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, set the Pixoo online, offline or silent, refusing with 400 a simulation that names an unknown device, action or field, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers, and it SHALL answer a query for one request or trace (see "Following one request in a disposable run"). The supervisor SHALL wait for a stopped runtime's stderr to drain, for at most a second, before it starts the next, so that a clean stop's last record is in the journal. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A capture step `follow-one-request` SHALL follow one request in each case of the query's proof, and a negative control `control-follow-fails` SHALL fail by expecting to find a request that was never sent. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, that every database the runtime has open is in the run's state directory, and that the credentials and token files are owner-only.

#### Scenario: Start, capture and stop
- **WHEN** a reviewer starts a run with the fixture modules, captures a catalog scenario, reseeds it to `zero-modules` and captures that scenario, then stops it
- **THEN** the preview links the runtime's health page, which answers, each capture passes, `doctor` reports every check passed and both listeners where the receipt says, and `stop` removes the unit, its lease timer and its runtime directory and closes both ports, while proof stays in the proof root and no token appears in a result, card or receipt

#### Scenario: Every catalog scenario in a run
- **WHEN** each catalog scenario's capture step runs on a freshly seeded run without a user manager
- **THEN** every step passes, attaches its scenario result and asserts the boundaries, the `edge-grants` step syncs with the reader's credential and gets `unauthenticated` without one, the negative control fails, and no step's proof or runtime record holds a part's token or the synthetic module token

#### Scenario: A crash in a run
- **WHEN** a crash is armed and a remote part switches the lamp
- **THEN** the remote part's request ends `uncertain-result`, the runtime starts again on the same port, the lamp's outbox republishes its three messages, and the simulated lamp keeps the state it reached

#### Scenario: Boundary crossed
- **WHEN** a run starts the shipped runtime without `--simulate`, a probe module that reaches for the installed Hub's port 8788 with fetch and with `node:http`, or the runtime without `--state-dir`
- **THEN** exactly the matching check fails, naming the crossing; the guard refuses both of the probe's attempts before they connect, and the runtime creates its default state directory under the run's private home, where `private-state` finds it

#### Scenario: The guard's reach
- **WHEN** a process under the guard tries `net`, `http.request`, `http.get`, `https.request`, `fetch`, a UDP send and a UDP connect from its main thread and a worker thread, and `http.get` from a child Node process
- **THEN** none connects or sends, each attempt is in the report file, and without the guard the same attempts reach their listeners

#### Scenario: A part's stream dropped in a run
- **WHEN** the harness ends the reader's stream at the edge, and the operator then switches the lamp
- **THEN** the same remote part reconnects, its subscription hears of the gap once, and it hears the switch's outcome; a module's source is refused with 400

#### Scenario: Overlapping restarts
- **WHEN** three restarts are asked for at once
- **THEN** they run one after another, each answers 200, and the run keeps one healthy runtime on its port

#### Scenario: Negative control on a running run
- **WHEN** a reviewer asks a running run to reseed into a boundary negative control
- **THEN** the command is refused with `start-only-scenario` and exit status 2 before anything changes

#### Scenario: Process cleanup
- **WHEN** a run's supervisor is stopped, or killed
- **THEN** its runtime child is gone and both ports are closed; a killed supervisor's child stops itself

#### Scenario: A configured run
- **WHEN** a reviewer starts the configured-module run and captures its scenario, stops it, then does the same with the misconfigured-module run
- **THEN** each capture passes, health shows the sign `running` and then `refused` with `invalid-request`, the runtime started with `--config`, and no capture log, attachment or runtime record holds the synthetic token

#### Scenario: A run follows one request
- **WHEN** a remote part switches the fixture lamp in a run, and the harness is asked for that request's records and spans
- **THEN** the answer holds the bus's admission and reply, the lamp's records and the core's intake, each with the runtime that wrote it, and the request, queue, execute, device and publish spans with their parents, and a clean first runtime shows no gap

#### Scenario: The proof step
- **WHEN** `follow-one-request` runs on a freshly seeded fixtures run, through a lifecycle run's real transient units and on a run started without a user manager
- **THEN** it passes, attaches one answer for the success, the refusal, the uncertain effect, the replayed outcome, the killed runtime, the absent request, the capped query and the trace, and its negative control `control-follow-fails` fails

#### Scenario: A Pixoo run
- **WHEN** a reviewer starts each Pixoo scenario's run and captures its scenario
- **THEN** each capture passes, the harness state reports what the simulated Pixoo shows, the new runtime's Pixoo after a restart shows what the last one showed, and setting the Pixoo offline before a restart starts it offline; a simulation of an unknown Pixoo action is refused with 400 and changes nothing
