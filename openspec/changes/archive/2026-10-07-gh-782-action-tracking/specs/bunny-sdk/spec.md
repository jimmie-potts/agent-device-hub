## MODIFIED Requirements

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id`, `time` and trace context it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out, and `transaction` SHALL reject with it. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. Once the work commits, `transaction` SHALL resolve with the work's result after the publish ends and SHALL NOT reject, so no caller takes a refused publish for a rollback and does the work again. If publishing is refused after the commit, the messages SHALL stay stored, unpublished, and the next transaction or start SHALL send them unchanged; nothing SHALL send them again on its own. The outbox SHALL report the refusal once per run of refusals with the same code, and again only after a send went through or the code changed, in one place: given the module's `log`, as one `outbox.deferred` record, as "Outbox records and spans" requires; otherwise to its `onError` as an `SdkError` with the refusal's registry code, or `internal` for an error without one, the fixed detail `committed, awaiting publication` and the refusal as its `cause`. Without an `onError`, the report SHALL become a `BunnySdkWarning` process warning that names the code and the fixed detail, never the refusal's message. `republish()` SHALL pass a refusal on to its caller, which it rejects, and SHALL NOT report it. Given a validator, `add` SHALL check each message against it and refuse a message it refuses with the validator's code, rolling the transaction back. A refusal that lasts holds back every later message, which waits behind the refused one in commit order, so a remote part's outbox SHALL be given `edgeValidator(schemas)`, the validator a remote edge checks with: profile 2.0, the core families, the device families and the given module schemas (Hub #782).

A state, removal or occurrence message SHALL be deleted once it has gone out, and an outcome SHALL be marked published. Once a send's messages settle, the outbox SHALL delete or mark every message that went out in one commit, after the sends, including those that went out before a refusal stopped the send. That commit, like `acknowledge` and the work's own commit, SHALL run at the connection's own `synchronous` level, so a power loss never undoes it. A send SHALL take the messages waiting when it starts: transactions that commit before a queued send starts SHALL share its commit, and one that commits while a send is under way SHALL wait for the next send. An outcome already marked published SHALL need no write. Once that commit lands, a state, removal or occurrence that went out SHALL never be sent again. A crash after a send and before that commit SHALL leave the batch to go out again at the next start, and a failure of that commit SHALL leave it to go out again with the next send, in both cases with the same `id`s; the failure SHALL be reported as a refused publish is, with the refusal's code when a refusal also stopped the send and `internal` otherwise. An outcome SHALL stay stored after it goes out until `acknowledge(id)` deletes it; `acknowledge` SHALL return whether the outbox held that outcome. The outbox SHALL follow the core's acknowledgments itself (Hub #782): when its participant can subscribe, `republish()` SHALL first subscribe, once, to `bunny.event.outcome-recorded.<module>`, and SHALL forget an outcome only on an `outcome-recorded` occurrence that names the participant's own source and the outcome's `id` and whose sender, the envelope's `source`, is the core, `bunny/core`. The acknowledgments heard in one turn of the event loop SHALL be forgotten together at its end, in one commit at the connection's level, so a burst of them costs one sync to disk. An acknowledgment from any other sender SHALL be ignored, keeping the outcome, and recorded once as `message.received` at WARN with `forbidden`; one that forgot an outcome SHALL be recorded as `outbox.acknowledged` at INFO, in its trace. So a lost or forged acknowledgment SHALL never discard a stored outcome. `republish()` SHALL then send, in order, everything still stored: messages a crash kept from going out or from being forgotten, and every outcome not yet acknowledged. It SHALL resolve with how many went out. The core drops duplicates by `(source, id)`. Nothing SHALL forget a message by time. One outbox SHALL serve one database connection.

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
- **THEN** the transaction resolves with the work's result, the work stays committed, every message waits unpublished, and the next start sends them unchanged, with their trace context

#### Scenario: Committed, then published with the next transaction
- **WHEN** a transaction commits while its publish is refused, a second one commits while it is still refused, and a later transaction commits once publishing works again
- **THEN** the first resolves with the work's result and is reported once as committed and awaiting publication, with the refusal's code; nothing sends again on its own past every deadline; the second is not reported again; the later transaction sends the waiting messages first, exactly as stored, then its own; and the next refusal is reported again

#### Scenario: A message the edge refuses
- **WHEN** an outbox over a remote participant stores an occurrence whose schema the edge does not know, and then a state
- **THEN** both transactions resolve, the refusal is reported once with `unknown-schema`, and both messages wait; with the edge's validator, the same occurrence rolls its transaction back with `unknown-schema`, nothing waits, and the next message goes out

#### Scenario: No command goes in
- **WHEN** work adds a command, a command on an event key, an occurrence on a state key or a message on a malformed key
- **THEN** each transaction is refused with `invalid-request`, and nothing is stored or sent

#### Scenario: Only synchronous work in the outbox's own transaction
- **WHEN** work returns a promise, the database is already in a transaction, or `add` is called after its transaction ended
- **THEN** the first rejects with `TypeError` and leaves no unhandled rejection, the others are refused with `invalid-state`, and nothing is stored or sent

#### Scenario: One commit for a publication batch
- **WHEN** a transaction adds a state, an occurrence and an outcome and all three go out, and later three transactions commit one after another without waiting for each other
- **THEN** the first makes two commits, its work's and one for the three messages, and the three make four, one each and one for the batch the first send took

#### Scenario: A transaction during a send
- **WHEN** a second transaction commits while the first transaction's send is under way
- **THEN** the first send takes only the first transaction's message, the second's goes out in the next send with a bookkeeping commit of its own, and each goes out once, in commit order

#### Scenario: A send refused partway
- **WHEN** the first of three messages goes out and the second is refused
- **THEN** one bookkeeping commit marks the first, the other two wait unpublished, the first's publication is recorded once, and the next transaction sends the two first

#### Scenario: A republish of published outcomes
- **WHEN** a module restarts with an outcome that went out but was not acknowledged, and republishes it
- **THEN** the outcome goes out again, unchanged, and nothing is written

#### Scenario: A failed bookkeeping commit
- **WHEN** the commit that would forget and mark a batch fails after its state, occurrence and outcome went out, and a later transaction commits once that commit can succeed
- **THEN** every row stays stored, the failure is reported once with `internal` and three messages waiting, no publication is recorded, and the next send sends the three again with their `id`s before the new message and records the outcome's publication once

#### Scenario: A kill between the sends and their bookkeeping
- **WHEN** a module process is killed with SIGKILL after its transaction's three messages went out and before their bookkeeping committed, and it restarts twice on the same database
- **THEN** the first restart sends the three again exactly as first sent, a consumer that drops duplicates takes each once, the second restart sends only the outcome, and the outcome's publication is recorded once

#### Scenario: A kill between the commit and the first send
- **WHEN** a module process is killed with SIGKILL after its transaction committed and before its first send, and it restarts twice on the same database
- **THEN** the work and the three messages are stored, unpublished, the first restart sends each once, the second only the outcome, and the outcome's publication is recorded once

#### Scenario: A kill after an acknowledgment mid-batch
- **WHEN** the core acknowledges an outcome after it went out and before its batch's bookkeeping committed, the module process is then killed with SIGKILL, and it restarts twice on the same database
- **THEN** the acknowledgment records the outcome's publication once, the outcome never goes out again, and the state and occurrence go out once more at the first restart only

#### Scenario: Every commit at the connection's level
- **WHEN** a module's database is opened as the runtime opens it, a transaction commits and publishes, the core acknowledges its outcome, and another transaction commits and publishes
- **THEN** the database is in WAL mode with exclusive locking at `synchronous = FULL`, and each work commit, each bookkeeping commit and the acknowledgment runs at FULL

#### Scenario: The core's acknowledgment forgets an outcome, and only the core's
- **WHEN** a module's outbox has republished, its outcome has gone out, another module publishes an `outcome-recorded` naming it, the core publishes one naming another module's outcome with the same ID, and then the core acknowledges it
- **THEN** the first two change nothing and the forged one is recorded as `message.received` at WARN with `forbidden`; the core's forgets the outcome, recorded as `outbox.acknowledged` at INFO in the outcome's trace; and the next start sends it no more

#### Scenario: Acknowledgments in one commit
- **WHEN** the core acknowledges 50 of a module's outcomes in one turn
- **THEN** the outbox forgets all 50 in one commit at the connection's level and records each as `outbox.acknowledged`

#### Scenario: A lost acknowledgment discards nothing
- **WHEN** a module stops before the core's acknowledgment of its outcome arrives, and starts again with the core acknowledging every outcome it gets
- **THEN** the outcome goes out again at the start, the core takes it once, and its acknowledgment then forgets it

#### Scenario: A remote outbox with the edge's validator
- **WHEN** a remote participant's outbox stores an occurrence the edge would refuse and then an outcome, without and then with `edgeValidator()`
- **THEN** without it the outcome waits behind the refused occurrence; with it the occurrence's transaction is refused with `unknown-schema` and the outcome goes out

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, and, each optional, its section of the configuration file, its secrets' synthetic text, an instance whose device never answers with how to recognize its `unavailable` report, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module and SHALL be the only part of the kit that loads `node:test`. `conformanceChecks(spec)` SHALL return the checks that apply as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner for the copied families: `bunny/core`, or the owner the description names for them, as a module that copies one device module's `device` records names it. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families, the core's acknowledgment among them, and the module's schemas registered; when a record the module logs is not one the runtime writes whole as a diagnostic-contract record, because its event is not registered for the `bunny.module` scope, a field is not a registered attribute, or a value is outside its registered type; when a message it sees, a command or sync request the module sends, a record the module logs, a span, a reply or a synced state carries one of the module's secrets, naming where but never the secret; or when a handler, timer or worker of the module fails, or its stop throws or outlasts its deadline. `checkModuleRecord(name, record)` SHALL return that record check's reason, naming the event and attribute keys but never a value, or undefined. The checks SHALL be:
- always, the manifest is one the runtime accepts, and `checkConfiguration` accepts the module's section;
- always, the module starts and stops within the deadline, and afterwards its accepted command and its served families, synced from the module by name, when given, are `unavailable`, and no timer or worker it started through its context and no open database is left;
- with an instance whose device never answers, policy A: that instance's start finishes within 1000 ms by default, because start opens only local resources, and the module then publishes a state that reports the device `unavailable`;
- with served families, a sync of them that names the module as its owner completes with states of those families from the module;
- with copied families, its start syncs them and asks for nothing else, and, when the description names their owner, every sync of them names that owner;
- with an accepted command, it accepts it;
- with a refused command, it refuses it in its own reply with the declared code;
- with an accepted command, the command's outcome is published, and published again, unchanged, after a restart on the same database without an acknowledgment;
- with an accepted command, an acknowledgment of its outcome from a participant other than the core changes nothing, so a restart publishes the outcome again; once `bunny/core` acknowledges it, the module records `outbox.acknowledged`, and the next restart publishes it no more (Hub #782).

`ModuleHarness` SHALL host a module as the runtime does: its section, checked with `checkConfiguration` before start, which throws the refusal's `SdkError` and never starts a module the runtime would refuse; its own participant with source `bunny/modules/<name>`, given to the module without `close`, whose commands and sync requests it keeps, each sync with the owner it names, since no subscriber sees them; a context whose SQLite file is `<name>.sqlite` and whose private folder is `<name>/` in a given directory, whose `secrets.read` serves the given secrets' text from memory for the names the section gives, and whose worker calls are the runtime's; and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database. The participant close and `stop()` SHALL each have a deadline, 5 s by default, and a step that throws or outlasts it SHALL be recorded as a failure without keeping the later steps from running.

The kit's stand-in acknowledgment is gone: a test's stand-in core SHALL publish the core's own, `acknowledgmentOf(outcome)`, as `bunny/core` (Hub #782).

#### Scenario: A conforming module passes
- **WHEN** a module that serves its family, answers its command and reports the outcome through its outbox runs the suite
- **THEN** every check passes, and there is no copies check when it copies nothing

#### Scenario: A module that only consumes
- **WHEN** a module that copies the mode and serves and answers nothing runs the suite
- **THEN** only the manifest, lifecycle and copies checks run, and they pass

#### Scenario: A module that copies a family that several modules serve
- **WHEN** a module that copies a bulb module's family names that owner, names none, or names an owner nobody runs, with the description naming the bulb module as the owner
- **THEN** every check passes for the first; only the copies check fails for the second; the lifecycle and copies checks fail for the third; and the harness keeps the module's sync with the owner it named

#### Scenario: The kit catches a non-conforming module
- **WHEN** a module publishes its outcome without the outbox, declares an unsupported API version, refuses with another code, has a stop that never finishes, or sends a state its schema refuses
- **THEN** the outbox and acknowledgment checks; the manifest check; the refusal check; the lifecycle, outbox and acknowledgment checks; or the sync, accept, outbox and acknowledgment checks fail, respectively, and every other check passes

#### Scenario: The kit catches a module record the runtime would not write
- **WHEN** a module logs an event the catalog does not register for modules, one of the runtime's own events, an unregistered attribute holding a raw message, or a URL in a registered attribute, while it handles its accepted command
- **THEN** the accept, outbox and acknowledgment checks fail, every other check passes, and the reason names no value

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

#### Scenario: The kit catches a module that mishandles the core's acknowledgment
- **WHEN** a module's outbox gets a participant that cannot subscribe, or a module forgets an outcome on any acknowledgment that names it, whoever sent it
- **THEN** only the acknowledgment check fails, and for the second it says that an acknowledgment from another participant than the core must be ignored
