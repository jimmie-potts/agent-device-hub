## ADDED Requirements

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant, clock and scheduler. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id` and `time` it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out. Work that returns a promise SHALL roll back with a `TypeError`, and a database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. If publishing is refused after the commit, `transaction` SHALL reject, and the messages SHALL stay stored for the next transaction or restart.

`republish()` SHALL send again, in order, every message still stored. A run SHALL forget a message it published once the module has kept running for `retainMs`, 60 s by default, after publishing it, and SHALL never forget a message that another run published. The consumer drops duplicates by `(source, id)`.

#### Scenario: Messages go out after the commit
- **WHEN** a transaction changes the module's table and adds a state, an occurrence and an outcome
- **THEN** the change commits, and the consumer receives each message once, in that order, exactly as `add` returned it, from the module's source

#### Scenario: A rolled-back transaction sends nothing
- **WHEN** the work adds messages and then throws
- **THEN** the transaction rejects with that error, the table and the outbox are unchanged, and nothing goes out, then or after a restart

#### Scenario: A crash between commit and publish
- **WHEN** the process dies after the commit and before any publish, and the module restarts on the same database and republishes
- **THEN** each stored message goes out once, the outcome naming its `requestId`, and a second restart soon after sends them again while a duplicate-dropping consumer still holds each exactly once

#### Scenario: A crash just after publish
- **WHEN** the process dies less than `retainMs` after publishing, and the module restarts and republishes
- **THEN** the same messages go out again, unchanged, and the consumer takes each once

#### Scenario: Forgotten after the retention time
- **WHEN** the module keeps running for `retainMs` after publishing, then restarts and republishes
- **THEN** nothing goes out again, and the outbox table is empty

#### Scenario: A run forgets only its own messages
- **WHEN** a run that never republishes publishes and forgets its own message while an earlier run's message is still stored
- **THEN** the next restart sends the earlier run's message again, and only that

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
- **THEN** the first rejects with `TypeError`, the others are refused with `invalid-state`, and nothing is stored or sent

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module, and `conformanceChecks(spec)` SHALL return them as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner, `bunny/core`, for the copied families. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families and the module's schemas registered, or when a handler, timer or worker of the module fails. The checks SHALL be:
- the manifest is one the runtime accepts;
- the module starts and stops within the deadline, and afterwards its command and its families are `unavailable`, and no timer, worker or open database is left;
- a sync of its families completes with states of those families from the module;
- when it copies families, its start syncs them and asks for nothing else;
- it accepts the accepted command;
- it refuses the refused command in its own reply with the declared code;
- the accepted command's outcome is published, and published again, unchanged, after a restart on the same database.

`ModuleHarness` SHALL host a module as the runtime does: its own participant with source `bunny/modules/<name>`, a context whose SQLite file is `<name>.sqlite` in a given directory, and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database.

#### Scenario: A conforming module passes
- **WHEN** a module that serves its family, answers its command and reports the outcome through its outbox runs the suite
- **THEN** every check passes, and there is no copies check when it copies nothing

#### Scenario: The kit catches a non-conforming module
- **WHEN** a module publishes its outcome without the outbox, declares an unsupported API version, refuses with another code, has a stop that never finishes, or sends a state its schema refuses
- **THEN** the outbox check; the manifest check; the refusal check; the lifecycle and outbox checks; or the sync, accept and outbox checks fail, respectively, and every other check passes
