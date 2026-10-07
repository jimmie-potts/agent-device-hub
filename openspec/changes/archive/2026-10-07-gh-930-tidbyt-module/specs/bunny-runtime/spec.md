## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`), the LIFX module (`lifx-module`, Hub #928) and the Tidbyt module (`runtime-tidbyt`, Hub #930) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.1`, positive memory figures and no modules

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running and each shipped device module, the playback, LIFX and Tidbyt modules, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

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

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a configured seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and SHALL start the runtime with it. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through a `RemoteEdge` on 127.0.0.1 with a run-generated token per part. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, the Tidbyt module showing agent status and what plays on a simulated cloud with each tile behind its 15-second gate, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

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
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token

#### Scenario: The Tidbyt's tiles
- **WHEN** the tidbyt-tiles scenario runs in process and through the edge: the runtime starts with no session and nothing playing over AirPlay, the hook observes a session start and a turn, then an approval prompt, its answer and a second prompt inside the gate, and the phone plays a song to the Move, pauses it and stops it
- **THEN** the idle start writes nothing to the simulated cloud; the status tile shows the frame the reader's sessions call for, and the burst makes one later push of the latest state, at least 15 seconds after the first; the now-playing tile shows the song's card and then the pause marker, behind its own gate, and leaves the rotation when the music stops; the reader holds the Tidbyt's device record from `bunny/modules/tidbyt` with no control; and neither the API key nor the cloud device appears in a log record, message, health entry or reader copy
