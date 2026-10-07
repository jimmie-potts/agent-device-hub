## MODIFIED Requirements

### Requirement: Sync a consumer's copy from its owner

The SDK SHALL give each participant `sync(families, handler, {timeoutMs, maxBuffered, parent, owner})`, which keeps a copy of one owner's families. `owner`, when given, SHALL be the owning participant's source, such as `bunny/modules/lifx`: every sync request of the copy SHALL go to that owner, and a served answer whose `sync.completed` comes from another source SHALL be refused with `unavailable`, which ends a first sync or the copy. A copy without `owner` SHALL send each request to its families' only owner and SHALL follow the owner whose `sync.completed` last served it. Every copy SHALL follow only the live messages whose `source` is the owner it follows: another source's state or removal on a synced family SHALL NOT change the copy or be reported to `onError`, a named copy SHALL NOT buffer it, and a message that waited in the buffer from another source than the owner that served the answer SHALL NOT be applied. It SHALL subscribe to `bunny.state.<family>.*` for each family before it sends any sync request of kind `sync-request` with a `requestId`, the families and `expiresat` set `timeoutMs` after its `time`, even when an overflow comes first. An entity SHALL be a state's schema family and `data.id`, or a removal's `data.entity`, at its `data.revision`.

Until the owner answers, live messages SHALL wait in a buffer of at most `maxBuffered` messages, 1024 by default. On the answer, the copy SHALL first take the owner's states. It SHALL then drop each held entity that is not a member and is at or below the sync revision, and apply each buffered message above the revision in order. Only then SHALL the handler be told about each change in that order: `updated`, `removed` and `synced`, so that when `synced` is told the copy has applied the snapshot and every buffered message above its revision. A change applied to the copy SHALL always be told, unless the copy was closed first.

After a sync, the copy SHALL apply live messages in order, with the same buffer bound while its handler catches up. It SHALL drop a duplicate, a revision older than the one it holds, anything at or below the sync revision, and a state at or below the revision of a removal it applied. A live message from the owner the copy follows that names no entity of the synced families SHALL be reported to `onError` and ignored.

A buffer overflow, or a message dropped on one of the copy's subscriptions, SHALL make the copy want a new sync, and a served answer to a request sent before the latest overflow SHALL NOT be applied; a refusal still ends the first sync or the copy. Each such overflow SHALL be reported to the bus's `onSyncRestart` with the copy's source and `sync <families>` as its pattern. A copy SHALL have at most one sync request outstanding: it SHALL send the next one only when no other is outstanding and its handler is not running.

`sync` SHALL resolve with the copy after its first sync. If that sync is refused, `sync` SHALL resolve as `rejected` with the shared error body instead. If it has not completed within `timeoutMs` of its first request, `sync` SHALL resolve as `rejected` with `unavailable`, naming the last request it sent; each later request of the first sync SHALL get only the time left. Only the first request SHALL join `parent`'s trace; a later request SHALL start its own. After that, a sync that cannot be served SHALL end the copy with a `failed` change; the copy SHALL keep its last records. A refused or failed copy SHALL follow nothing more, however many messages arrive. Closing a copy SHALL withdraw its outstanding request, and a first sync still under way SHALL resolve as `rejected` with `cancelled`. A copy closed while it is still subscribing to its families SHALL make no further subscription and SHALL close the one it was making. A request that the transport rejects or throws on SHALL be reported to `onError` and refused with `unavailable`. A family list that is empty, longer than 32, repeated, not made of family names or longer than 256 characters joined SHALL be refused with `invalid-request`. So SHALL a `timeoutMs` that is not an integer from 1 to `MAX_TIMEOUT_MS`, a `maxBuffered` that is not a positive integer, and an `owner` that is not a participant source, before any request is sent.

#### Scenario: Current state, then live messages
- **WHEN** an owner holds two sessions and a consumer syncs, and the owner later updates one
- **THEN** the handler hears `updated` for each session and `synced` at the owner's revision, the request and `sync.completed` validate against profile 2.0 and continue the caller's trace, and the later update arrives as `updated`

#### Scenario: Buffered live messages apply above the sync revision
- **WHEN** live messages at and below the snapshot's revision, and others above it, arrive while the answer is on its way
- **THEN** nothing is applied before the answer, the messages at or below the revision are dropped, and those above it apply after `synced`, in order

#### Scenario: An entity above the sync revision survives the sync
- **WHEN** a copy holds a@5, starts a sync, receives y@15 live, and the sync completes at revision 14 with members [a]
- **THEN** the copy holds a@5 and y@15

#### Scenario: A removal during a sync stays removed
- **WHEN** a removal of y at 16 arrives during a sync that completes at 14 listing y, and a state of y at 15 arrives afterwards
- **THEN** y is removed, and the late state does not bring it back

#### Scenario: A buffer overflow restarts the sync
- **WHEN** more live messages arrive during a sync than the buffer holds
- **THEN** a new sync request is sent, nothing from the first answer is applied, and the copy matches the second answer

#### Scenario: A sync replaces membership
- **WHEN** a copy holds a and b, b's removal is dropped by its full queue, and the next sync's members are [a]
- **THEN** the handler hears that b was removed without a removal message, and the copy holds only a

#### Scenario: A delivery-queue overflow restarts the sync
- **WHEN** the copy's subscription drops an update because its queue is full
- **THEN** the copy sends a new sync request and ends with the dropped update's state, not the older one

#### Scenario: A refused first sync
- **WHEN** the owner refuses the first sync with an error body
- **THEN** `sync` resolves as `rejected` with that body, its `requestId` and the caller's trace ID, the handler hears nothing, and later live messages do not reach it

#### Scenario: A later sync that cannot be served
- **WHEN** the owner stops serving and the copy's subscription then drops a message
- **THEN** the handler hears `failed` with `unavailable`, and the copy follows nothing more but keeps its last records

#### Scenario: Duplicates and stale revisions
- **WHEN** a synced copy receives a repeated state, older states, a state at or below the sync revision, a removal, a state older than that removal and the removal again
- **THEN** only the newer state and the first removal change the copy

#### Scenario: No replay
- **WHEN** an owner published occurrences and removed a session before a consumer syncs, and publishes another occurrence during the sync
- **THEN** the handler hears only the current state and `synced`

#### Scenario: A stalled handler
- **WHEN** a copy's handler stalls while 49 messages arrive, 46 more than its buffer of 3 holds
- **THEN** the owner receives no more than one further sync request, and once the handler returns it hears the resync rather than each buffered message

#### Scenario: A second consumer while another copy overflows
- **WHEN** one copy's buffer overflows again and again while the owner serves its request, and a second consumer then syncs
- **THEN** the second consumer is served next, and the first copy replaces its request once

#### Scenario: A copy's own requests and the owner's queue
- **WHEN** the owner's queue holds at most one waiting request and a copy overflows several times while its request is served
- **THEN** the copy completes its sync, never refused with `capacity` by its own requests

#### Scenario: A first sync that keeps overflowing
- **WHEN** two answers to a copy's first sync each arrive 400 ms after more live messages than its buffer holds, and a third never arrives
- **THEN** the third request gets only the 200 ms left, and `sync` resolves as `rejected` with the retryable `unavailable` at 1000 ms

#### Scenario: A first sync out of time
- **WHEN** the only answer to a first sync arrives at its deadline after an overflow
- **THEN** no further request is sent, and `sync` resolves as `rejected` with `unavailable` naming the request that was sent

#### Scenario: Subscriptions before any request
- **WHEN** a copy of two families sees an overflow on the first while the second is still subscribing
- **THEN** no request is sent until the second subscription exists, and then exactly one is

#### Scenario: Only the first request joins the caller's trace
- **WHEN** a copy synced with a parent trace syncs again after an overflow
- **THEN** the first request carries the parent's trace ID and the second starts a new trace

#### Scenario: A refused copy stays stopped
- **WHEN** an owner refuses a first sync, or a later sync fails, and more messages than the buffer holds then arrive while an owner serves
- **THEN** no further sync request is sent and the handler hears nothing more

#### Scenario: A snapshot older than the copy
- **WHEN** a copy applied a@5 live and a later sync answers with a cached snapshot at revision 3 that lacks a
- **THEN** the copy keeps a@5

#### Scenario: Closing during a change
- **WHEN** a copy is closed while its handler runs on the first of several changes from one answer
- **THEN** the close resolves after that handler returns, and the remaining changes are not told

#### Scenario: A message without an entity
- **WHEN** a live message from the copy's owner on a synced family's key has no schema identifier, and another source publishes such a message too
- **THEN** the owner's is reported to `onError` with the copy's source and ignored, the other source's is ignored without a report, and later messages still apply

#### Scenario: A transport that fails
- **WHEN** the transport's sync request rejects, or throws
- **THEN** the error is reported, and `sync` resolves as `rejected` with `unavailable` naming the request

#### Scenario: Hub #842's reference scenarios
- **WHEN** each of the eight sync, removal and expiry scenarios in `fixtures/v2/families.json` is fed to SDK copies as a transport would deliver it
- **THEN** the copies hold exactly the entities the scenario expects

#### Scenario: A malformed sync call
- **WHEN** a sync names no family, a repeated or malformed family, more than 32 families or more than 256 characters of them joined, or has a bad `timeoutMs`, `maxBuffered` or `owner`, on either transport
- **THEN** it is refused with `invalid-request`, and no owner receives a request

#### Scenario: Each owner of one family by name
- **WHEN** two owners serve `device`, one over the transport under test and one on the bus, a consumer syncs `device` from each by name, and then each owner publishes a device update, and the second owner publishes a removal of the first owner's device
- **THEN** on both transports each copy holds only its owner's devices, its `sync.completed` comes from that owner and lists only them, each copy applies only its own owner's updates, the removal changes neither copy, and nothing is reported to `onError`

#### Scenario: Another owner's traffic and a named copy's buffer
- **WHEN** a copy that names its owner and holds at most two buffered messages waits for its first answer while another owner of the family publishes five messages and its own owner publishes one
- **THEN** the copy applies its owner's snapshot and update, restarts no sync, and its owner receives one request

#### Scenario: A copy that names no owner and a second owner
- **WHEN** a copy without an owner has synced `device` at revision 5 from its only owner, a second owner then serves `device` and publishes its own device at revisions 3 and 7 and a removal of the first owner's device, and the first owner publishes an update
- **THEN** on both transports the copy holds only the first owner's device, at its update, and nothing is reported to `onError`

#### Scenario: Another owner's messages buffered during a first sync
- **WHEN** a copy without an owner waits for its only owner's answer while a second owner starts serving `device` and publishes, and its own owner publishes an update
- **THEN** the copy applies its owner's snapshot and update and not the second owner's message

#### Scenario: An answer from another owner
- **WHEN** a named copy's first answer comes from another owner, and another named copy's resync after an overflow is answered by another owner
- **THEN** the first resolves as `rejected` with `unavailable`, its `requestId`, the caller's trace ID and a detail naming both owners, and its handler hears nothing; the second copy's handler hears `failed` with `unavailable`

#### Scenario: A named copy's later requests
- **WHEN** an overflow restarts the sync of a copy that names its owner, and a copy that names none syncs
- **THEN** both requests of the first copy name that owner, and the second copy's request carries no owner

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, and, each optional, its section of the configuration file, its secrets' synthetic text, an instance whose device never answers with how to recognize its `unavailable` report, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module and SHALL be the only part of the kit that loads `node:test`. `conformanceChecks(spec)` SHALL return the checks that apply as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner for the copied families: `bunny/core`, or the owner the description names for them, as a module that copies one device module's `device` records names it. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families, the stand-in acknowledgment and the module's schemas registered; when a record the module logs is not one the runtime writes whole as a diagnostic-contract record, because its event is not registered for the `bunny.module` scope, a field is not a registered attribute, or a value is outside its registered type; when a message it sees, a command or sync request the module sends, a record the module logs, a span, a reply or a synced state carries one of the module's secrets, naming where but never the secret; or when a handler, timer or worker of the module fails, or its stop throws or outlasts its deadline. `checkModuleRecord(name, record)` SHALL return that record check's reason, naming the event and attribute keys but never a value, or undefined. The checks SHALL be:
- always, the manifest is one the runtime accepts, and `checkConfiguration` accepts the module's section;
- always, the module starts and stops within the deadline, and afterwards its accepted command and its served families, synced from the module by name, when given, are `unavailable`, and no timer or worker it started through its context and no open database is left;
- with an instance whose device never answers, policy A: that instance's start finishes within 1000 ms by default, because start opens only local resources, and the module then publishes a state that reports the device `unavailable`;
- with served families, a sync of them that names the module as its owner completes with states of those families from the module;
- with copied families, its start syncs them and asks for nothing else, and, when the description names their owner, every sync of them names that owner;
- with an accepted command, it accepts it;
- with a refused command, it refuses it in its own reply with the declared code;
- with an accepted command, the command's outcome is published, and published again, unchanged, after a restart on the same database without an acknowledgment.

`ModuleHarness` SHALL host a module as the runtime does: its section, checked with `checkConfiguration` before start, which throws the refusal's `SdkError` and never starts a module the runtime would refuse; its own participant with source `bunny/modules/<name>`, given to the module without `close`, whose commands and sync requests it keeps, each sync with the owner it names, since no subscriber sees them; a context whose SQLite file is `<name>.sqlite` and whose private folder is `<name>/` in a given directory, whose `secrets.read` serves the given secrets' text from memory for the names the section gives, and whose worker calls are the runtime's; and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database. The participant close and `stop()` SHALL each have a deadline, 5 s by default, and a step that throws or outlasts it SHALL be recorded as a failure without keeping the later steps from running.

Until Hub #782 defines the core's acknowledgment, the kit SHALL offer a stand-in: `standInAck(outcome)`, an occurrence on `bunny.event.stand-in-ack.<module>`, and `followStandInAcks(sdk, outbox)`, which passes each one naming the module's outcome to `outbox.acknowledge`.

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

## REMOVED Requirements

### Requirement: Serve sync from the owner's current state
**Reason**: It allowed one owner per family, and Hub #967 keys sync ownership by source and family, so every device module serves `device` for its own devices. OpenSpec keeps every scenario name of a modified requirement, and the scenario "One owner per family" becomes "One owner per family per source", so the requirement is replaced rather than modified.
**Migration**: "Serve sync from each owner's current state" carries every other scenario unchanged. A sync that names no owner behaves as before while one owner serves its families; a consumer of a family that several owners serve names the owner.

## ADDED Requirements

### Requirement: Serve sync from each owner's current state

The SDK SHALL give each participant `serveSync(families, provider)`. Ownership SHALL be keyed by source and family. Only a shared family, which the SDK lists and exports as `SHARED_FAMILIES` and which today is `device` alone, MAY have several owners, each for its own entities, as every device module serves `device` for its own devices. A `serveSync` naming a family that the same source already serves, or a family that is not shared and that another source serves, SHALL be refused with `invalid-state`, and an empty, repeated or malformed family list with `invalid-request`. The bus SHALL name the families each source serves now, in the order it registered them, through `served(source)`. An owner MAY serve any number of families; the request caps apply only to one sync request. The owner SHALL handle one sync request at a time and SHALL ignore a request at or past its expiry. A request still waiting in the owner's queue at its deadline, or withdrawn, SHALL leave the queue, so the owner never serves it; one at its deadline SHALL still be refused with `unavailable`, never `expired`, because a sync changes nothing and asking again is safe. A sync request SHALL go to the owner it names, or, when it names none, to the only owner of its families, and to that owner alone: the SDK SHALL never spread one request across owners or merge owners' records. The owner SHALL travel beside the request, not in its message: in the transport's sync call, as a routing key travels beside a command. A remote edge SHALL pass a `sync` call's `owner` to its bus, and SHALL refuse one that is not a participant source with `invalid-request`. The provider SHALL receive the request and return `{revision, states}`, one state draft per entity, or an error body. The SDK SHALL send each state as a state message from the owner, then `sync.completed` with the `requestId`, the revision and the members. It SHALL send them straight to the requester, never to subscribers, continuing the request's trace.

A sync request SHALL be refused in the shared error body, naming its `requestId` and trace ID, with no `sync.completed`:
- with the provider's error body;
- `internal` when the provider throws, or its snapshot holds a state outside the requested families, without an entity ID or above the snapshot's revision, has a revision that is not a whole number from 0, or holds more than 4096 states; the error SHALL also go to `onError`;
- `unavailable` when no owner serves a family, the named owner does not serve one of its families, the owner closed before serving it, no answer came by the deadline, or the transport failed to send it;
- `cancelled` when the requester's copy or participant closed before the answer came;
- `capacity` when the owner's queue already holds `maxQueued` waiting requests;
- `invalid-request` when the request names no owner and several owners serve one of its families, saying to name the owner, or when its families do not all belong to one `serveSync` of one owner.

#### Scenario: A sync nobody can serve
- **WHEN** a sync names a family that no owner serves, or the owner's provider throws or returns a snapshot that does not fit the request
- **THEN** it resolves as `rejected` with `unavailable` or `internal`, and each provider failure is reported to `onError` with the owner's source

#### Scenario: An owner closes or is full
- **WHEN** an owner is serving one request, a second waits, a third arrives and the owner then closes
- **THEN** the third is refused with `capacity`, the second with `unavailable`, and the first still gets its answer

#### Scenario: A deadline and an expired request
- **WHEN** the owner is busy past one request's deadline and then answers a request whose own deadline passed while it waited
- **THEN** each request resolves as `unavailable` at its deadline, a late answer changes nothing, and the provider never receives the expired request

#### Scenario: A copy closed while it subscribes
- **WHEN** a copy of three families is closed while its transport is still making the first subscription
- **THEN** it resolves as `rejected` with `cancelled`, asks for no other family and closes the subscription it was making

#### Scenario: A sync request still queued at its deadline
- **WHEN** a sync request waits behind another in an owner's queue of one until its deadline passes
- **THEN** it resolves as `rejected` with the retryable `unavailable`, naming its `requestId` and trace ID, the next request queues in the room it left instead of being refused with `capacity`, and the provider never receives it

#### Scenario: A restart is reported
- **WHEN** a synced copy's delivery queue drops a message and the copy syncs again
- **THEN** `onSyncRestart` receives the copy's source and `sync <families>` once, and the first sync was not reported

#### Scenario: One owner per family per source
- **WHEN** an owner serves a family again, from the same participant or another participant with the same source, another source serves a family that is not shared, two more sources serve `device`, a sync names families of two owners, or an owner serves 38 families
- **THEN** the first two are refused with `invalid-state`, each other source's `device` succeeds, the sync resolves as `rejected` with `invalid-request`, and the owner of 38 families and a sync of one owner's families succeed

#### Scenario: A faulty owner of a family that is not shared
- **WHEN** the core serves its family and `device`, a third participant serves `playback`, `lifx-light` and `device`, and another participant then serves the core's family, alone or with `mode`, `playback`, or `lifx-light` with `mode`, and then `mode` and `device`
- **THEN** on both transports the first four are refused with `invalid-state` naming the family's owner, the last succeeds, and a sync of the core's family that names no owner is served by the core

#### Scenario: The families a source serves
- **WHEN** a source serves one family, then two more through another registration, another source serves `device`, the first registration closes, and then the source's participant closes
- **THEN** `served` lists the source's three families in registration order, the other source's `device`, nothing for a source that serves nothing, then the two families left, and then nothing

#### Scenario: A sync that names no owner
- **WHEN** one owner serves `device` and a consumer syncs it without naming an owner, then a second owner serves `device` and the consumer syncs it again, then the first owner closes and the consumer syncs once more
- **THEN** on both transports the first sync is served by the only owner; the second resolves as `rejected` with `invalid-request`, its `requestId`, the caller's trace ID and the detail `several owners serve device; name the owner to sync from`, neither provider receives it, no `sync.completed` follows and the bus records one `sync.refused` at INFO; and the third is served by the remaining owner

#### Scenario: A named owner that does not serve the family
- **WHEN** a consumer names an owner that serves another family, one that is not connected, or one that serves only some of the requested families
- **THEN** on both transports each sync resolves as `rejected` with the retryable `unavailable` and the detail `no owner serves <family> as <owner>`, the bus records one `sync.refused` at WARN for each, and no provider receives a request

#### Scenario: A malformed owner at the edge
- **WHEN** a remote part's `sync` call names an owner that is not a participant source, then one that serves the family, then none while two owners serve it
- **THEN** the edge refuses the first with `invalid-request` and records the refusal without its detail, serves the second with that owner's states only, and the third is refused with `invalid-request`
