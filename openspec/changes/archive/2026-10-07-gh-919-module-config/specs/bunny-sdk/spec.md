## MODIFIED Requirements

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. `MODULE_API_VERSION` SHALL be `1.1`, which adds the module's configuration, secrets, private folder and worker calls to `1.0`; a `1.0` module SHALL still be accepted.

The manifest MAY declare a synchronous `configure(section)` that returns `{config, devices?}` or a refusal from `errorBody`, whose detail SHALL be fixed text that repeats no value from the section, since health shows it. A module's context SHALL type its configuration as possibly undefined, because `configure` is optional. `checkConfiguration(manifest, section)` SHALL check a module's own section of the runtime's configuration file as the runtime does before it starts the module, and SHALL return `{status: 'accepted', config, devices, secrets}` or `{status: 'refused', problem}`: a module that declares `configure` needs a section (`not-found`); a section is a JSON object (`invalid-request`); its `secrets` member, when present, maps at most 16 names, each lowercase letters and digits with single hyphens, to absolute paths (`invalid-request`); `configure` must not refuse, with the refusal's code and detail, throw (`internal`, keeping what it threw in memory only) or answer neither a configuration nor a valid refusal (`internal`); and its devices must be distinct routing IDs of at most 128 characters (`invalid-request`). A module without `configure` SHALL get an undefined configuration and the secrets its section names. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

#### Scenario: The kit and the runtime check the same configuration
- **WHEN** `checkConfiguration` gets no section for a module with `configure`, an array, malformed secrets, a refusing or throwing `configure`, devices that are not distinct routing IDs, and a valid section
- **THEN** it refuses them with `not-found`, `invalid-request`, `invalid-request`, the refusal's code or `internal`, and `invalid-request`, and accepts the valid one with its configuration, devices and secrets; the runtime refuses and the kit's manifest check fails for the same sections

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, and, each optional, its section of the configuration file, its secrets' synthetic text, an instance whose device never answers with how to recognize its `unavailable` report, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module and SHALL be the only part of the kit that loads `node:test`. `conformanceChecks(spec)` SHALL return the checks that apply as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner, `bunny/core`, for the copied families. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families, the stand-in acknowledgment and the module's schemas registered; when a record the module logs is not one the runtime writes whole as a diagnostic-contract record, because its event is not registered for the `bunny.module` scope, a field is not a registered attribute, or a value is outside its registered type; when a message it sees, a command or sync request the module sends, a record the module logs, a span, a reply or a synced state carries one of the module's secrets, naming where but never the secret; or when a handler, timer or worker of the module fails, or its stop throws or outlasts its deadline. `checkModuleRecord(name, record)` SHALL return that record check's reason, naming the event and attribute keys but never a value, or undefined. The checks SHALL be:
- always, the manifest is one the runtime accepts, and `checkConfiguration` accepts the module's section;
- always, the module starts and stops within the deadline, and afterwards its accepted command and its served families, when given, are `unavailable`, and no timer or worker it started through its context and no open database is left;
- with an instance whose device never answers, policy A: that instance's start finishes within 1000 ms by default, because start opens only local resources, and the module then publishes a state that reports the device `unavailable`;
- with served families, a sync of them completes with states of those families from the module;
- with copied families, its start syncs them and asks for nothing else;
- with an accepted command, it accepts it;
- with a refused command, it refuses it in its own reply with the declared code;
- with an accepted command, the command's outcome is published, and published again, unchanged, after a restart on the same database without an acknowledgment.

`ModuleHarness` SHALL host a module as the runtime does: its section, checked with `checkConfiguration` before start, which throws the refusal's `SdkError` and never starts a module the runtime would refuse; its own participant with source `bunny/modules/<name>`, given to the module without `close`, whose commands and sync requests it keeps, since no subscriber sees them; a context whose SQLite file is `<name>.sqlite` and whose private folder is `<name>/` in a given directory, whose `secrets.read` serves the given secrets' text from memory for the names the section gives, and whose worker calls are the runtime's; and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database. The participant close and `stop()` SHALL each have a deadline, 5 s by default, and a step that throws or outlasts it SHALL be recorded as a failure without keeping the later steps from running.

Until Hub #782 defines the core's acknowledgment, the kit SHALL offer a stand-in: `standInAck(outcome)`, an occurrence on `bunny.event.stand-in-ack.<module>`, and `followStandInAcks(sdk, outbox)`, which passes each one naming the module's outcome to `outbox.acknowledge`.

#### Scenario: A conforming module passes
- **WHEN** a module that serves its family, answers its command and reports the outcome through its outbox runs the suite
- **THEN** every check passes, and there is no copies check when it copies nothing

#### Scenario: A module that only consumes
- **WHEN** a module that copies the mode and serves and answers nothing runs the suite
- **THEN** only the manifest, lifecycle and copies checks run, and they pass

#### Scenario: The kit catches a non-conforming module
- **WHEN** a module publishes its outcome without the outbox, declares an unsupported API version, refuses with another code, has a stop that never finishes, or sends a state its schema refuses
- **THEN** the outbox check; the manifest check; the refusal check; the lifecycle and outbox checks; or the sync, accept and outbox checks fail, respectively, and every other check passes

#### Scenario: The kit catches a module record the runtime would not write
- **WHEN** a module logs an event the catalog does not register for modules, one of the runtime's own events, an unregistered attribute holding a raw message, or a URL in a registered attribute, while it handles its accepted command
- **THEN** the accept and outbox checks fail, every other check passes, and the reason names no value

#### Scenario: The harness stops a module as the runtime does
- **WHEN** a hosted module's stop throws, or never finishes
- **THEN** the module had no `close` on its participant, the harness's stop still ends within its deadline and closes the database, and it records the error or the passed deadline as a failure

#### Scenario: Another runner
- **WHEN** a process imports the kit, or Vitest runs `conformanceChecks`
- **THEN** `node:test` is not loaded

#### Scenario: Policy A's check
- **WHEN** a configured module that reaches its device on its scheduler with a deadline runs the suite, and a variant whose start waits on its device runs it too
- **THEN** every check passes for the first, the offline check included, and for the variant only the offline check fails

#### Scenario: A configuration the module refuses or lacks
- **WHEN** a configured module runs the suite with a section its `configure` refuses, or with none
- **THEN** every check fails, since the module never starts

#### Scenario: A secret where it must not be
- **WHEN** a configured module puts the secret it read in a log record, in a published state, in a command it sends that nothing answers, in a span it records, in a refusal's detail, or only in the states it serves through sync
- **THEN** every check that starts it fails for the record, the state, the command and the span, only the refusal check fails for the detail, only the serves check fails for the synced state, and no failure quotes the secret

#### Scenario: The harness's secrets and folder
- **WHEN** a hosted module reads a named secret held with a trailing line break, a secret its section does not name, and a named secret with no text, and asks for its folder, then stops
- **THEN** it gets the text without the line break, `not-found` twice, a mode 700 folder `<name>/`, and after the stop `invalid-state` for both

## ADDED Requirements

### Requirement: Bounded worker calls

`WorkerCalls`, which the runtime and the kit's harness both give a module as `workers.call(file, request, {timeoutMs, signal?, transferList?})`, SHALL run one request in a new worker thread from a module file: the worker gets `request` as its `workerData` and answers with one message, and the call SHALL resolve with that message and terminate the worker. The deadline SHALL be an integer from 1 to `MAX_TIMEOUT_MS` on the module's scheduler, and a module SHALL have at most `MAX_WORKER_CALLS`, 4, calls running. A call SHALL end once, terminating its worker and releasing its deadline and listeners, and SHALL reject with an `SdkError` with a fixed detail. Before its worker starts, a call SHALL be refused with no effect: `invalid-state` once the module has stopped, `invalid-request` for a malformed deadline, `cancelled` when its own signal has already aborted, `capacity` beyond the limit, and `internal` when the worker cannot start. Once the worker has the request, every ending but its reply SHALL be `uncertain-result`, since the worker may have done part of its work (ADR 0012: a rejection proves no effect, and cancellation is not undo): the deadline passing, the module's signal or the call's own signal aborting, the worker throwing, its reply being unreadable, or its ending without a reply. What the worker threw SHALL stay in memory as the cause only.

#### Scenario: A reply, a deadline and a stop
- **WHEN** a worker answers, another never answers with a 2000 ms deadline on a manual scheduler, and a third never answers when the module's signal aborts
- **THEN** the first resolves with the reply and leaves no deadline, the second is still pending at 1999 ms and rejects with `uncertain-result` at 2000 ms, the third rejects with `uncertain-result`, every worker is terminated, and a later call rejects with `invalid-state`

#### Scenario: Failures stay with the call
- **WHEN** a worker throws an error quoting a synthetic token, another ends without a reply, a third's reply cannot be read, a call's own signal aborts after its worker started, a fifth call starts while four run, and calls have deadlines of 0, -1, 1.5, `MAX_TIMEOUT_MS` + 1 and NaN
- **THEN** the first four reject with `uncertain-result`, the first keeping the thrown error as the cause, the fifth with `capacity` and the deadlines with `invalid-request`, and no error message quotes the token

#### Scenario: Refused before the worker starts
- **WHEN** a call's own signal has already aborted, or its file is not a `file:` URL
- **THEN** it rejects with `cancelled` or `internal`, and no worker starts
