## MODIFIED Requirements

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id`, `time` and trace context it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out, and `transaction` SHALL reject with it. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. Once the work commits, `transaction` SHALL resolve with the work's result after the publish ends and SHALL NOT reject, so no caller takes a refused publish for a rollback and does the work again. If publishing is refused after the commit, the messages SHALL stay stored, unpublished, and the next transaction or start SHALL send them unchanged; nothing SHALL send them again on its own. The outbox SHALL report the refusal once per run of refusals with the same code, and again only after a send went through or the code changed, in one place: given the module's `log`, as one `outbox.deferred` record, as "Outbox records and spans" requires; otherwise to its `onError` as an `SdkError` with the refusal's registry code, or `internal` for an error without one, the fixed detail `committed, awaiting publication` and the refusal as its `cause`. Without an `onError`, the report SHALL become a `BunnySdkWarning` process warning that names the code and the fixed detail, never the refusal's message. `republish()` SHALL pass a refusal on to its caller, which it rejects, and SHALL NOT report it. Given a validator, `add` SHALL check each message against it and refuse a message it refuses with the validator's code, rolling the transaction back. A refusal that lasts holds back every later message, which waits behind the refused one in commit order.

A state, removal or occurrence message SHALL be deleted once it has gone out, so it is never sent again, and an outcome SHALL be marked published. Once a send's messages settle, the outbox SHALL delete or mark every message that went out in one commit, after the sends, including those that went out before a refusal stopped the send. Transactions that commit while a send is under way SHALL share that commit, and an outcome already marked published SHALL need no write. A crash after a send and before that commit SHALL leave the batch to go out again at the next start, with the same `id`s. An outcome SHALL stay stored after it goes out until `acknowledge(id)` deletes it; `acknowledge` SHALL return whether the outbox held that outcome. `republish()` SHALL send, in order, everything still stored: messages a crash kept from going out or from being forgotten, and every outcome not yet acknowledged. It SHALL resolve with how many went out. The consumer drops duplicates by `(source, id)`. Nothing SHALL forget a message by time.

When the module's database is in WAL mode and the connection's `synchronous` level is above `NORMAL`, the bookkeeping commit and `acknowledge` SHALL run at `NORMAL`, which leaves their sync to the next sync of the log, and SHALL restore the connection's level at once, so the work's own commit keeps the module's level. A power loss can then only undo them, which leaves the rows stored to go out again. Out of WAL mode, or inside a transaction someone else holds open, they SHALL keep the connection's level.

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

#### Scenario: A send refused partway
- **WHEN** the first of three messages goes out and the second is refused
- **THEN** one bookkeeping commit marks the first, the other two wait unpublished, the first's publication is recorded once, and the next transaction sends the two first

#### Scenario: A republish of published outcomes
- **WHEN** a module restarts with an outcome that went out but was not acknowledged, and republishes it
- **THEN** the outcome goes out again, unchanged, and nothing is written

#### Scenario: A kill between the sends and their bookkeeping
- **WHEN** a module process is killed with SIGKILL after its transaction's three messages went out and before their bookkeeping committed, and it restarts twice on the same database
- **THEN** the first restart sends the three again exactly as first sent, a consumer that drops duplicates takes each once, the second restart sends only the outcome, and the outcome's publication is recorded once

#### Scenario: A kill between the commit and the first send
- **WHEN** a module process is killed with SIGKILL after its transaction committed and before its first send, and it restarts twice on the same database
- **THEN** the work and the three messages are stored, unpublished, the first restart sends each once, the second only the outcome, and the outcome's publication is recorded once

#### Scenario: Bookkeeping without its own sync in WAL mode
- **WHEN** a module's database is in WAL mode at `synchronous = FULL`, a transaction commits and publishes, the core acknowledges its outcome, and another transaction commits and publishes
- **THEN** each work commits at FULL, each bookkeeping commit and the acknowledgment at NORMAL, and the connection is back at FULL; in rollback journal mode every commit is at FULL

### Requirement: Outbox records and spans

An `Outbox` given the module's `log` SHALL record an outcome's first publication once, as `outcome.published` at INFO for `succeeded` and WARN for `failed` or `uncertain`, with its request ID, message ID, outcome and error code and the outcome's own trace context. It SHALL make that record once the commit that marks the outcome published lands, so after a crash between the send and that commit the run that sends the outcome again makes it. Publishing a stored outcome again SHALL make no such record. A publish refused after the commit SHALL make one `outbox.deferred` record at WARN with the refusal's code and the count of messages still waiting, once per run of refusals, in place of the report to `onError`; a refusal that `republish()` passes on to its caller SHALL make none. Given the module's `trace`, the outbox SHALL record a `bunny.outcome.publish` span for each outcome it sends: a child of the outcome's stored context when the same transaction stored it, and otherwise a new root linked to that context, never a child of it, as after a restart or a deferred publish. Without them, the outbox SHALL record nothing.

#### Scenario: First publication and replay
- **WHEN** a transaction stores and publishes an outcome, and the module restarts and republishes it
- **THEN** there is exactly one `outcome.published` record, in the outcome's trace, the first publish span is the stored context's child, and the replayed one is a root linked to it

#### Scenario: A deferred publish
- **WHEN** a transaction commits while its publish is refused, and a later transaction publishes the waiting messages
- **THEN** one `outbox.deferred` warning names the code and the waiting count, a second refused transaction in that run makes none, `onError` hears nothing, the outcome's publication is recorded once when it goes out, and its publish span links to its stored context
