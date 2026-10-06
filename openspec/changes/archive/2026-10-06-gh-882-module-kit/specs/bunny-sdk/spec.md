## ADDED Requirements

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id` and `time` it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. If publishing is refused after the commit, `transaction` SHALL reject, and the messages SHALL stay stored for the next transaction or start.

A state, removal or occurrence message SHALL be deleted once it has gone out, so it is never sent again. An outcome SHALL stay stored after it goes out until `acknowledge(id)` deletes it; `acknowledge` SHALL return whether the outbox held that outcome. `republish()` SHALL send, in order, everything still stored: messages a crash kept from going out, and every outcome not yet acknowledged. It SHALL resolve with how many went out. The consumer drops duplicates by `(source, id)`. Nothing SHALL forget a message by time.

#### Scenario: Messages go out after the commit
- **WHEN** a transaction changes the module's table and adds a state, an occurrence and an outcome
- **THEN** the change commits, and the consumer receives each message once, in that order, exactly as `add` returned it, from the module's source

#### Scenario: A rolled-back transaction sends nothing
- **WHEN** the work adds messages and then throws
- **THEN** the transaction rejects with that error, the table and the outbox are unchanged, and nothing goes out, then or after a restart

#### Scenario: A crash between commit and publish
- **WHEN** the process dies after the commit and before any publish, and the module restarts on the same database and republishes
- **THEN** the three stored messages go out once, the outcome naming its `requestId`, and the next restart sends only the outcome again while a duplicate-dropping consumer still holds each exactly once

#### Scenario: A clean restart replays nothing but the unacknowledged outcome
- **WHEN** a run publishes a state, an occurrence and an outcome, and the module restarts and republishes
- **THEN** only the outcome goes out again, unchanged, the consumer takes each message once, and a later transaction sends only its own messages

#### Scenario: An outcome published while the core had failed
- **WHEN** an outcome goes out while no consumer listens, ten minutes pass, and the module restarts with the consumer listening
- **THEN** the outcome goes out again, and the consumer takes it once

#### Scenario: An acknowledged outcome
- **WHEN** the core acknowledges an outcome, before or after it first goes out
- **THEN** `acknowledge` returns true once, the outbox no longer holds it, and no start sends it again; acknowledging a state, an occurrence or an unknown id returns false

#### Scenario: Each message once per run, in order
- **WHEN** three transactions commit one after another without waiting for each other
- **THEN** their messages go out once each, in commit order

#### Scenario: A refused publish keeps the message
- **WHEN** the module's participant has closed and a transaction commits
- **THEN** the transaction rejects with `invalid-state`, the work stays committed, and the next start sends the messages

#### Scenario: No command goes in
- **WHEN** work adds a command, a command on an event key, an occurrence on a state key or a message on a malformed key
- **THEN** each transaction is refused with `invalid-request`, and nothing is stored or sent

#### Scenario: Only synchronous work in the outbox's own transaction
- **WHEN** work returns a promise, the database is already in a transaction, or `add` is called after its transaction ended
- **THEN** the first rejects with `TypeError` and leaves no unhandled rejection, the others are refused with `invalid-state`, and nothing is stored or sent

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, and, each optional, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module and SHALL be the only part of the kit that loads `node:test`. `conformanceChecks(spec)` SHALL return the checks that apply as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner, `bunny/core`, for the copied families. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families, the stand-in acknowledgment and the module's schemas registered, or when a handler, timer or worker of the module fails, or its stop throws or outlasts its deadline. The checks SHALL be:
- always, the manifest is one the runtime accepts;
- always, the module starts and stops within the deadline, and afterwards its accepted command and its served families, when given, are `unavailable`, and no timer or worker it started through its context and no open database is left;
- with served families, a sync of them completes with states of those families from the module;
- with copied families, its start syncs them and asks for nothing else;
- with an accepted command, it accepts it;
- with a refused command, it refuses it in its own reply with the declared code;
- with an accepted command, the command's outcome is published, and published again, unchanged, after a restart on the same database without an acknowledgment.

`ModuleHarness` SHALL host a module as the runtime does: its own participant with source `bunny/modules/<name>`, given to the module without `close`; a context whose SQLite file is `<name>.sqlite` in a given directory; and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database. The participant close and `stop()` SHALL each have a deadline, 5 s by default, and a step that throws or outlasts it SHALL be recorded as a failure without keeping the later steps from running.

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

#### Scenario: The harness stops a module as the runtime does
- **WHEN** a hosted module's stop throws, or never finishes
- **THEN** the module had no `close` on its participant, the harness's stop still ends within its deadline and closes the database, and it records the error or the passed deadline as a failure

#### Scenario: Another runner
- **WHEN** a process imports the kit, or Vitest runs `conformanceChecks`
- **THEN** `node:test` is not loaded
