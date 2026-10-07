## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`) and the LIFX module (`lifx-module`, Hub #928) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts, `serves` with the families it serves through sync while it serves any (Hub #967) and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running and each shipped device module, the playback and LIFX modules, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

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

### Requirement: Modules that serve one family side by side

The runtime SHALL start and run several modules that serve the same sync family, such as `device`, which every device module serves for its own devices (Hub #918, #967). A module's source on the bus SHALL be `bunny/modules/<name>`, or `bunny/core` for the core, so the module names that the shipped module list and health give are the owners a consumer names. Each module's health entry SHALL list in `serves` the families it serves through sync now, and SHALL have no `serves` while it serves none, so a consumer syncs a shared family only from the modules that serve it. A module, or a remote part through the runtime's edge, SHALL sync such a family from each owner by name and get only that owner's records; a sync that names no owner while several serve the family SHALL be refused with `invalid-request` and recorded once as `runtime.sync.refused` at INFO.

The fixture lamp and the configured fixture sign SHALL each serve their own devices' `device/2.0` records beside their own family: the lamp's record names its kind with every capability unsupported, and the sign's carries the sign's availability, which the sign publishes as a device record whenever it publishes the sign's changed state. The scenario catalog's seed SHALL let a reader's copy name its owner, and the reader view SHALL read one owner's copy of a family. The catalog's `device-owners` scenario SHALL run in the in-memory harness on both transports and in a disposable run.

#### Scenario: Two modules that serve device run
- **WHEN** the runtime starts two in-test modules that both serve `device` for their own devices, and a third module that syncs `device` from each by name at its start
- **THEN** health shows all three running with status `ok`, and `serves` lists `device` for the two device modules and is absent for the third; the third module's copy from each owner holds only that owner's devices, a remote part through the edge syncs each owner by name with the same result, and its sync that names no owner is refused with `invalid-request` and recorded once at INFO

#### Scenario: The device-owners scenario
- **WHEN** the catalog's `device-owners` scenario starts the core, the lamp and the configured sign, offline at first, and the reader follows `device` from the lamp and from the sign by name
- **THEN** every module runs, and health names the lamp and the sign, and no other module, as serving `device`; the copy from the lamp holds only lamp-1; the copy from the sign holds only sign-1, unavailable after the sign's deadline and available once it is online; each copy synced once; and the reader's own syncs of `device` with no owner and from the core are refused with `invalid-request` at INFO and `unavailable` at WARN, each recorded once
