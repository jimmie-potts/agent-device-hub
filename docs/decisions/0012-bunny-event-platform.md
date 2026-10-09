# ADR 0012: One event and messaging platform for every component

Status: accepted on 2026-10-05, amended on 2026-10-06, 2026-10-07 and 2026-10-08 (see
[Amendments](#amendments)).
Supersedes [ADR 0010](0010-shared-event-contracts.md).
This decision implements and installs nothing by itself. The children of
[epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) own
source delivery, installation and physical acceptance, as well as delivery order.

## Context

B.U.N.N.Y. components exchange observations, snapshots, commands and receipts
through separate contracts:
- The Hub calls each controller over its own HTTP port.
- Consumers poll or stream Hub snapshots in their own way.
- The components use at least six error shapes and about ten spellings of a
  version field.

ADR 0010 defined a CloudEvents profile but chose staged, need-only adoption and
no broker. Its profile has no runtime user. Components added after it chose
their own formats.

On 2026-10-04 and 2026-10-05 the owner asked for a well-designed event platform
that powers all communication between components, captures history and follows
one format everywhere. The owner wants it delivered before other feature work,
apart from the CHOMPI agent-controls integration already in progress. Epic #827
records that sequencing.

## Decision

### Scope and adoption

This decision covers every message that crosses a component boundary in Hub,
Nanoleaf, Pixoo and future repositories: events, commands, replies and errors.
Error handling, retries, logs and traces also follow it. Any new or changed
communication between components follows this ADR.

Until the cutover, a component may extend its released 1.x contract
additively. This includes the owner's CHOMPI work. It adds no new message
format, error shape or new path that polls the Hub for state.

The platform is a rebuild, not an in-place evolution of the Hub:
- `apps/runtime` starts as a new skeleton, built test-first, and the core runs
  with zero modules.
- Proven code moves in with its tests rather than being rewritten: Pixoo's
  packages are copied as a staged snapshot, and Nanoleaf is ported from Python
  with its behavior tests. Staged code keeps its baseline until its module
  story converts it.

The original offline-cutover decision follows. The 2026-10-08
[fresh-start amendment](#amendments) supersedes its data-migration and mandatory
retirement provisions for the selected delivery; the rest remains applicable.

Existing formats move in one offline cutover:
- Each contract gets a 2.0 version that follows these conventions.
- The new runtime and its modules are built and tested in disposable runs with
  simulated devices. The installed system stays untouched until the cutover.
- The cutover ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840))
  replaces the installed system in one maintenance window; downtime is
  acceptable. Personal data is backed up, migrated and verified, because
  downtime is not data loss.
- The retirement story ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839))
  then removes the 1.x formats, routes and controller HTTP command ports.
- Released 1.x artifacts stay compatible until that removal: additive changes
  only.

### Runtime and transport

- One TypeScript runtime process, `apps/runtime`, hosts the core (agent state,
  automation, inbox, history and the action tracker) and every device as a
  module.
- Modules are a fixed list shipped with the runtime, each with a manifest.
  There is no general plug-in framework, middleware stack or durable
  subscription system. Adding or removing a module is a code change.
- Modules talk through an in-process message bus provided by the SDK
  (`packages/sdk`), which offers publish, subscribe, sync, request and respond.
  Messages pass as objects; schemas are checked at module boundaries in tests
  and always at remote edges.
- Remote parts (the CHOMPI bridge and Wispr collector on Windows, agent hooks,
  the dashboard and MCP clients) use the same SDK calls over SSE down and HTTP
  up. There is no broker.
  Wispr retains its manually selected published-file handoff as an owner-approved
  exception (2026-10-07, #927); the collector and file contract stay unchanged,
  and a later messaging conversion is deferred to #977.
- A module imports only the SDK and the contracts packages, never another
  module.
- **Failure isolation:** a device's errors and timeouts are not module
  failures. A module reaches its device lazily and turns the device's errors
  and timeouts into outcomes and an `unavailable` device state (policy A, owner
  decision 2026-10-06). An error that escapes a module, whether thrown,
  rejected or a start that outlasts its deadline, stops only that module. The
  module shows as failed and stays stopped until the runtime restarts; nothing
  restarts it automatically. A blocked event loop or memory exhaustion affects
  the whole process, so the service manager restarts the runtime.
- Everything is TypeScript. Nanoleaf is ported from Python, and the Python
  contract mirrors retire with it.

### Message kinds

- **State events** say what an entity looks like now. Each one carries the
  complete current record of one entity (a session, the mode, an inbox item, the
  playback state), never a diff. Consumers replace their copy.
- **Removal events** say an entity is gone, for example an expired session, a
  retired subtree or a deleted record, so a consumer never keeps a stale copy.
- **Occurrence events** say what happened, such as `attention.raised`,
  `attention.cleared` or `turn.ended`. They matter even when the state later
  looks the same.
- **Commands** are live-only requests addressed to the one owner of what they
  change. They carry an expiry, are never stored and never replay after a
  restart.
- **Replies** answer a command immediately with `accepted` or with a rejection
  in the shared error body. `accepted` means the owner has taken responsibility
  for reporting the command's outcome, not that anything was sent, done or
  observed; see [Errors, effects and outcomes](#errors-effects-and-outcomes).
- **Outcomes** complete a command: `succeeded`, `failed` or `uncertain`, with
  evidence `transmitted`, `observed` or `none`. `none` means there is no
  evidence that anything reached the device, as after a failure before sending
  or a lost answer; a succeeded outcome always has `transmitted` or `observed`
  evidence, and a failed one carries an error.
- **Sync** messages bring a consumer up to date: a sync request to an owner,
  answered with the owner's current state at a revision and then
  `sync.completed`. A sync replaces the consumer's full membership, so entities
  the owner no longer has disappear.

### Ownership and publication

- One owner publishes each fact, and one writer controls each device. The core
  state owner stays authoritative. This is not event sourcing.
- Core changes and their tracker, history and inbox rows commit in one SQLite
  transaction, then publish.
- Each module keeps its own SQLite file and saves only the state it owns.
  Copies of other owners' state are rebuilt by sync, not stored.
- A module reports outcomes through its own outbox. Each outcome is saved,
  marked unreported, in the module's transaction and published after the
  commit. It is published again after a restart until the core has it, and the
  core drops duplicates by `(source, id)`. A crash never loses an outcome, and
  no command is ever re-sent.
- Agent hooks stay bounded and fail-open. Vendor adapters that must poll (Sony,
  Sonos) publish what they observe.

### Consumers and recovery

- A consumer syncs from the owner when it connects or restarts. The owner sends
  its current state at a revision. Live messages that arrive meanwhile wait in
  a bounded buffer, and those above the revision apply in order afterwards. An
  overflow restarts the sync instead of combining partial state. An owner that
  cannot serve a sync refuses it with the shared error body, returned by the SDK
  call that sent the request, and sends no `sync.completed`.
- A consumer then follows live events. It drops duplicates and stale revisions,
  and ignores commands and sync requests past their expiry.
- This delivery has no replay. Here, replay means redelivering past
  occurrences or effects to views or devices. That rules out:
  - rebuilding views from the log;
  - replaying history into views;
  - catch-up for displays.

  Syncing current state is not replay. Neither is reporting a module's
  unreported outcome again after a restart.
- History and the tracker live in the core and record durably. A slow consumer
  lags only itself and cannot block the bus.

### High-impact messages

Device commands, moments and mode changes are tracked:
- The core records each one as sent, then accepted when the reply arrives, then
  completed when the outcome arrives.
- If its deadline passes first, the core records it as uncertain. A command
  still queued at its deadline never reached the owner, so the SDK answers it
  `expired` instead; the core records only an unknown fate as uncertain. Failed
  and uncertain results go to the shared inbox. A later outcome is handled as
  [Errors, effects and outcomes](#errors-effects-and-outcomes) describes.
- Every step is logged.
- A timed-out command is never retried automatically.
- The core claims a physical change only when the device reported an observation.

State events and telemetry are not tracked.

### Inbox and history

- One shared inbox in the core holds failed and uncertain operations, and
  operations with conflicting outcomes: the results a person must decide on.
  Items survive restarts until handled, with no expiry and no automatic
  clearing. Handling an item once clears it everywhere; dismissing it on a
  display is a separate fact.
- A finished turn is not an inbox item. Its unread state stays on the session
  record, which consumers sync and derive what they show from. Evidence clears
  it: read evidence for a consumer that uses it, the session's end, or a new
  turn in that session for a consumer set to clear on one. Acknowledgments are
  recorded per consumer, and each consumer's policy decides which
  acknowledgments clear what it shows, as today.
- The session's existing expiry still applies: a session with no lifecycle
  evidence for 24 hours is forgotten, and its unread state with it, as today.
  History keeps the turn-ended occurrence.
- Long-term history is private SQLite in the core store, with no time limit, a
  dashboard timeline and a read API. Viewing history never triggers devices or
  automation.
- When the disk is full, the core refuses durable work before it reports
  anything accepted.

### Envelope and conventions

- Every message is CloudEvents 1.0 structured JSON under B.U.N.N.Y. profile 2.0.
  Its attributes are `specversion`, `bunnyprofile`, `id`, `source`, `type`,
  `subject` (the event subject), `time`, `kind` (the message kind),
  `datacontenttype`, `dataschema` and `traceparent`. Commands and sync requests
  also carry `expiresat`, and no other kind may. Profile 1.0's `deliveryclass`
  is gone: `kind` replaces it. There is no `tracestate` or baggage: the
  [diagnostic contract](../observability-contract.md) disables their
  propagation, so validators refuse `tracestate` like any other undefined
  attribute.
- Messages are capped at 256 KiB. The validators enforce the cap at remote
  edges and in tests; in-process messages pass as objects. Larger content stays
  in its owner's store, and the message carries its ID, size and hash.
- Event types are named `org.bunny.<entity>.<past-tense verb>`. Command types
  are named `org.bunny.<entity>.<verb>.requested`. Replies, outcomes and
  removals end in `.replied`, `.completed` and `.removed`; state and occurrence
  events may not use those suffixes or `.requested`. Sync uses `org.bunny.sync.requested` and
  `org.bunny.sync.completed`, and the whole `org.bunny.sync.` namespace belongs
  to sync messages.
- SDK routing keys are named `bunny.<state|event|cmd>.<family>.<id>`:
  lowercase, shallow, with hyphens inside tokens. "Routing key" means the SDK's
  key; "event subject" means the CloudEvents `subject` attribute.
- One error body serves HTTP responses, MCP tool results, command replies and
  validators:
  `{"error": {"code", "retryable", "requestId", "traceId", "detail"}}`.
  - Codes are kebab-case and come from one registry in the contracts package,
    which also fixes each code's `retryable`. Validators refuse any other code
    or flag.
  - `detail` is optional; `requestId` and `traceId` appear when known.
  - MCP protocol errors keep the MCP specification.
- Each document carries one schema identifier, `<family>/<major>.<minor>`:
  - A message carries it as the absolute URI
    `https://bunny.invalid/events/<family>/<major>.<minor>` in `dataschema`, as
    CloudEvents requires.
  - HTTP and stored documents carry the same suffix in `schema`.
  - Routes carry only the major version.
- Event `id` values keep profile 1.0's identifier rule: 1 to 128 letters,
  digits, underscores, dots or hyphens. The retry identity stays
  `(source, id)`. Requests carry a `requestId`. Controllers keep their
  `{epoch, sequence}` ticket ordering.
- JSON payload fields are camelCase. There are two deliberate exceptions:
  CloudEvents context attributes keep their lowercase names, and log records
  keep OpenTelemetry field names.
- Envelope `time` is RFC 3339 UTC with milliseconds. Payload instants are
  integer `<name>AtMs`.
- Payloads share building blocks from the contracts package: identifiers,
  instants, revisions, the `{epoch, sequence}` ticket, ordering that is either
  unknown or names its authority, epoch and sequence, tagged unknown values
  (`{"status": "unknown"}`), kebab-case enum values, entity references and the
  error body.

### Errors, effects and outcomes

An error code says why a request was refused or failed. The result and its
evidence say what may have happened. Every boundary keeps the two apart.

- **One registry, one mapping.** Codes come only from the registry. Expected
  refusals are typed: a responder returns an error body from `errorBody`, and
  an SDK call refuses with `SdkError`. An unexpected exception is mapped once,
  at the boundary that knows whether an effect may have begun, and passed on
  unchanged after that.
- **A rejection proves no effect.** A request is `rejected` only when it had no
  effect: it was refused before its handler started, or its handler refused it
  with a typed refusal before acting. An exception after the handler started, a
  deadline that passed while the handler had the command, or a lost answer
  leaves the request `uncertain` with `uncertain-result`. Evidence `none` means
  there is no evidence that anything reached the device, not proof that nothing
  did.
- **`accepted`.** The owner's `accepted` reply means it validated the command
  and is responsible for reporting its outcome. When finishing the command needs
  durable state, the owner stores that state before it replies, and with a full
  disk it refuses instead. It stores its own record of the work, never the
  command message. Stored intent is responsibility, never a queue: after
  a restart the owner reports an outcome for each accepted command that has
  none. That outcome is `uncertain`, or `failed` when the owner's records prove
  no effect began, and the command never runs again.
- **Retries.** A code's `retryable` flag says whether the condition may clear.
  It never permits resending a command, and nothing resends one automatically:
  not the SDK, a remote edge, a module or the core. Only reconnection,
  observation, sync and outbox publication repeat on their own, and the core
  acknowledges a duplicate outcome again. Each retry loop has one owner and
  capped backoff, each observation or sync attempt has a deadline, and repeated
  failures are summarized rather than logged per attempt. Within one command, a
  module may repeat an idempotent device write that its device protocol expects
  to be repeated, inside the command's deadline and a fixed budget that its
  tests count. A remote edge refuses a command that a client sends again with
  the same `(source, id)` as `duplicate-conflict`, the code for a reused
  `(source, id)`, whether or not its content differs (settled in review, #835).
- **Deadlines and cancellation** end waiting, not work already done.
  Cancellation is not undo. A command still queued at its deadline is
  `expired`, and one its handler had is `uncertain`. An outcome keeps any
  earlier or partial effect, such as part of an upload, with its evidence,
  rather than reporting a plain failure.
- **Committed is not published.** Once an owner's transaction commits, the work
  stands. A publication failure after the commit is reported as committed and
  awaiting publication, never as a rollback, so no caller repeats the work. The
  outbox publishes it later. A stored message keeps its `id`, `time` and trace
  context across publication and restarts.
- **Acknowledging outcomes.** Only the core acknowledges a module's outcome,
  after it commits the outcome and its `(source, id)`. A module accepts an
  acknowledgment only from the authenticated core. The core acknowledges an
  exact duplicate again without a second completion, and refuses the same
  `(source, id)` with different content as `duplicate-conflict`, keeping it
  for diagnosis. A lost or forged acknowledgment never discards a stored
  outcome.
- **Late and conflicting outcomes** (owner decision, 2026-10-07):
  - A definitive outcome, `succeeded` or `failed`, that arrives after the
    tracker recorded `uncertain` replaces the tracker's status. History keeps
    both.
  - The operation's inbox item is updated with the new evidence and stays until
    a person handles it. It is not dismissed automatically.
  - An identical retransmission is deduplicated.
  - A `succeeded` and a `failed` outcome for one operation keep both pieces of
    evidence, and the item shows the conflict for a person to decide. Arrival
    order never picks the winner. The tracker records the conflict with both
    outcomes, and an operation with no item gets one (settled in review).
  - After a person has handled the item, a late outcome updates only the
    tracker and history; a conflict reopens the operation's item, because it
    needs a decision (settled in review).
  - A reused `(source, id)` with different content is a faulty message, not a
    conflicting outcome: the core refuses it with `duplicate-conflict` and
    keeps it for diagnosis, with no inbox item (settled in review).
  - An operation has at most one inbox item.
- **Safe errors.** Error bodies, health, history and proof carry registry codes
  and fixed text from the code that raised the error. For an error, a log record
  carries only its code, its type and the registered static body. None carries
  an exception's message, stack or cause; the original cause stays in memory.

### Observability

- **Correlation.** Every HTTP call and every message between B.U.N.N.Y.
  components carries W3C `traceparent`, and every log line carries `trace_id`
  and `span_id` under the
  [diagnostic contract](../observability-contract.md), so one request can be
  followed through every component.
- **Recorded spans.** Spans with a start, end, status and parent or links are
  recorded through the observability package's host adapter
  (`createHostDiagnostics` from `@jimmie-potts/bunny-observability/host`),
  with tracing on, no exporter and a bounded local span sink. Today the adapter
  records spans only with a collector, so #949 adds that sink to the adapter
  and the diagnostic contract, within the contract's queue bounds. A
  disposable run samples every request, so one request can be followed
  unless a queue bound drops its records; #949 sets the installed runtime's
  ratio within the contract. The
  SDK defines a small span interface, and the runtime implements it with that
  adapter; there is no second tracing implementation. Span names are the
  contract's registered names.
- **Context stays inside B.U.N.N.Y.** A boundary trusts incoming context only
  after it authenticates and validates the input. No trace context reaches a
  device or vendor; a module's device calls may have local spans. A message
  republished after a restart links to its original context and is never
  reparented, and no span stays open across downtime.
- **Records at decision points.** The boundary that makes a decision records
  it, once:
  - the SDK bus and remote edges: admission or refusal, no responder, a full
    queue, expiry, cancellation, the reply, and completion or uncertainty;
  - the runtime host: module lifecycle, module failures and outcome
    publication;
  - the core: outcome intake and tracker steps.

  The SDK reports through an optional callback, a no-op by default, that the
  runtime connects to its sink. A catch that only passes an error on does not
  log it.
- **Levels.**
  - DEBUG: bounded retries, polling and duplicate observations.
  - INFO: accepted work, success, recovery, expected cancellation, and
    validation and domain refusals.
  - WARN: refusals a correct caller should never receive (`unauthenticated`,
    `forbidden`, `too-large` and `duplicate-conflict`), lost capacity, queued
    expiry, failed and uncertain outcomes, and a device becoming unreachable.
  - ERROR: internal faults, a module failure, and configuration that prevents
    operation.
  - FATAL: the runtime cannot continue.

  Severity never changes a domain outcome.
- **Repetition.** A repeated condition logs its transition, then bounded
  summaries: the first dropped delivery is logged at once, then a count each
  minute. A polled device that stays offline logs one degradation and one
  recovery, not a warning per poll, and polling publishes no state event that
  changed nothing.
- **Logs are not history.** History holds domain records and logs hold
  diagnostics. They share request and trace IDs, codes and entity IDs, never
  payloads. A republished or duplicate outcome writes no second execution
  record.
- **Bounds.** The diagnostic contract's queue bounds, field rules and
  exclusions apply. Request and trace IDs never become metric or stream labels.
  A failing sink never changes a domain result and never logs its own failure
  into itself.
- **Telemetry is never acknowledged.** Its bounded queues can drop records
  under pressure, and the diagnostic contract makes that loss visible.
- **Following one request.** A disposable run can show the records and spans
  of one request or trace
  ([#950](https://github.com/jimmie-potts/agent-device-hub/issues/950)). A
  missing record is reported as missing, never as proof that nothing happened.
- **Owners.** [#949](https://github.com/jimmie-potts/agent-device-hub/issues/949)
  owns the new instrumentation. Export and viewing in Grafana belong to
  [#813](https://github.com/jimmie-potts/agent-device-hub/issues/813).

### Portability

Services use only the TypeScript SDK: publish, subscribe, sync, request and
respond. They never depend on a transport directly, which keeps a later move to
AWS cheap. To support that:
- Everything a consumer needs lives in the message body.
- Duplicate handling, ordering and expiry live in the envelope and the consumer,
  not in transport features.
- Loading current state is the sync interface. The core keeps a snapshot read
  API as a second implementation.
- The outboxes and the history API do not depend on the transport.

A later move would replace the SDK's remote transport, for example with SNS and
SQS and a DynamoDB latest-record table. Only data stores and services that never
touch local devices are candidates for cloud hosting. Device modules and fast
reactions stay on the home network.

### Personal data

Profile 2.0 drops profile 1.0's privacy-based field exclusions.
[ADR 0011](0011-private-personal-data-retention.md), as amended on 2026-10-05,
governs personal data:
- It is stored only in private owner-controlled storage on the runtime host.
- It may be sent to Claude and Codex in prompts.
- It never goes to GitHub.

Credentials, tokens and secrets never enter messages, logs or history. Prompt,
response and transcript capture remains separate work in
[#425](https://github.com/jimmie-potts/agent-device-hub/issues/425).

## Alternatives and consequences

These alternatives were rejected:
- **A NATS JetStream broker as a separate service.** The original 2026-10-05
  decision. One runtime process with an in-process bus removes a service, its
  credentials and its stream configuration. The cost is that modules no longer
  run in separate processes, and remote parts need the SDK's own SSE and HTTP
  transport.
- **Separate services over internal HTTP ports.** Today's design. Each pair of
  components needs its own client, error shape and token.
- **A general plug-in framework** with dynamic loading, middleware or durable
  subscriptions. A fixed module list covers one operator's devices.
- **One shared database with module-owned tables.** It would make cross-module
  updates atomic, but modules would lose their own files. The per-module outbox
  gives the needed guarantee: no outcome is lost.
- **Evolving the installed Hub in place.** Every step would have to keep 1.x
  contracts, polling paths and error shapes working while replacing them. A new
  skeleton with proven code moved in keeps the tested behavior and drops the
  rest. The cost is two codebases until the cutover, with moved code under its
  old lint baseline until its module story converts it.
- **Staged installs with the old and new systems running side by side.**
  Downtime is acceptable (owner decision, 2026-10-06), so one offline cutover
  avoids shadow runtimes and compatibility feeds.
- **A durable log hosted in the Hub.** We would have to build consumer
  positions, redelivery and retention ourselves.
- **Staged, need-only adoption (ADR 0010).** It produced no adopter while new
  formats kept appearing.
- **Fine-grained change events only.** Every consumer would have to rebuild the
  core's state logic.
- **A whole snapshot in every event.** It would exceed the size cap.
- **AWS SNS and SQS now.** They would add an internet round trip and an internet
  dependency to every device reaction, and they lack request/reply
  primitives.
- **Event sourcing.** Deferred to a later deliberate decision.

The consequences:
- One process: a crash, a blocked event loop or memory exhaustion stops every
  module until the service manager restarts the runtime. Memory is measured from
  the skeleton on.
- The cutover replaces the old system in one maintenance window. Real devices
  first meet the new code there, after testing in disposable runs with simulated
  devices.
- Consumer copies are eventually consistent, so every consumer must handle
  duplicates and lag.
- Module stores, history and backups add operational work.
- No replay: a consumer that was down misses occurrences such as `turn.ended`
  and sees only the current state after its sync. That state includes each
  session's unread finished turn and the shared inbox; history keeps the
  occurrences it receives.
- Live-only commands: a command to an offline module is lost, not queued. The
  owner sees it as failed or uncertain and can resend it.
- Tracking: each tracked kind needs a deadline. Uncertain items need a person to
  decide, because nothing retries them automatically.
- Conservative results: an exception after a handler started is `uncertain`,
  not a rejection, and conflicting outcomes wait for a person, so some items
  that a rule could settle need a person to decide.
- 256 KiB cap: content above it needs a second fetch by reference from its
  owner.
- SDK only: we maintain the SDK's two transports and give up direct use of any
  transport's features.

Reassess if a device cannot keep its behavior under the runtime, if the runtime
moves hosts or to the cloud, or if a second operator or remote access is
selected.

## Amendments

**2026-10-06.** The owner revised the design on 2026-10-05, after this record
was first accepted, and adopted a plan review on 2026-10-06. Epic
[#827](https://github.com/jimmie-potts/agent-device-hub/issues/827) records
both. Each change and its trade-off:

- **No broker.** One TypeScript runtime with an in-process bus replaces NATS
  JetStream. Remote parts use SSE and HTTP through the SDK. The trade-off is a
  shared process; see Consequences.
- **Fixed, shipped modules.** Each device is a module with a manifest and its
  own SQLite file, limited to the SDK and contracts packages. Adding a module
  is a code change.
- **Sync instead of latest-value retention.** Consumers sync from the owner on
  connect or restart. A bounded buffer holds live messages during the sync, and
  an overflow restarts it.
- **Removal events.** Removal events, and the membership replacement a sync
  performs, keep consumers from holding entities the owner removed.
- **Outboxes.** Core changes and their tracker, history and inbox rows commit
  in one transaction. Each module reports outcomes through its own outbox,
  deduplicated by the core. This replaces the broker relay.
- **Failure isolation.** It is stated honestly: a module's errors are
  contained, but process-wide failures restart the runtime.
- **TypeScript only.** The Python client library and contract mirrors are not
  needed for 2.0. The cost is porting Nanoleaf's Python worker, with its
  behavior tests, before the cutover.
- **Rebuild.** A new skeleton, built test-first, runs the core with zero
  modules; proven code moves in with its tests. Evolving the Hub in place was
  rejected; see Alternatives.
- **Envelope.** Profile 2.0 adds `kind`, which replaces `deliveryclass`,
  limits `expiresat` to commands and sync requests, reserves the reply,
  outcome, removal and sync type names for their kinds, and fixes each error
  code's `retryable` in one registry. Outcome evidence may be `none`: no
  evidence that anything reached the device, after a failure before sending or
  a lost answer.
- **One offline cutover.** It replaces the dual-version period and the staged
  installs, because downtime is acceptable.

**2026-10-06, `expired`.** A command that the bus knows never reached its owner,
because it was still queued at its deadline, is answered `expired` rather than
uncertain ([#880](https://github.com/jimmie-potts/agent-device-hub/issues/880)).
Uncertain now means only an unknown fate, so fewer items need a person to
decide.

**2026-10-06, inbox scope.** The owner chose to keep finished turns off the
shared inbox. A finished turn's unread state stays on the session record, as
today: the evidence described under "Inbox and history" clears it, and the
session's 24-hour expiry without lifecycle evidence removes it with the session
(owner, 2026-10-06). The inbox keeps only failed and uncertain operations, the
results a person must decide on, and inbox notices are no longer a tracked kind
under "High-impact messages". One inbox item per finished turn would repeat the
session list, grow without bound and need paged syncs; devices already learn of
a finished turn from session state when they sync.
[#782](https://github.com/jimmie-potts/agent-device-hub/issues/782) removes the
turn-ended variant of the 2.0 `inbox-item` family: the turn-ended sentence in
MAPPING.md's `notices` row, the synced `bunny-message-profile` requirement on a
turn-ended item's `session`, and the README, schema, types, checks and fixtures
that carry it. Corrected the same day during
[#918](https://github.com/jimmie-potts/agent-device-hub/issues/918)'s review
(owner, 2026-10-06): "Inbox and history" first said that a consumer's own
acknowledgment clears a finished turn on that consumer only. Acknowledgment
scope stays as today instead: acknowledgments are recorded per consumer, and
each consumer's policy decides which ones clear what it shows. LIFX and Tidbyt
clear a finished turn on any consumer's acknowledgment.

**2026-10-07, errors, effects and diagnostics.** The owner adopted a review of
the logging and tracing plan on 2026-10-07, with three tightenings: reuse the
observability package's host adapter for spans, keep tracker resolution apart
from inbox handling, and gate the next runtime stories on these rules
([#947](https://github.com/jimmie-potts/agent-device-hub/issues/947)). Each
change and its trade-off:

- **Errors, effects and outcomes** is a new section. It separates why something
  failed from what may have happened, and settles `accepted`, retries,
  deadlines, cancellation, publication after commit, acknowledgments, late
  and conflicting outcomes, and safe errors. The trade-off is more `uncertain`
  results: a responder that throws after its handler started is no longer an
  `internal` rejection.
  [#948](https://github.com/jimmie-potts/agent-device-hub/issues/948) brings
  the SDK into line.
- **Late and conflicting outcomes.** A late definitive outcome resolves the
  tracker but not the inbox item; a person still handles it. Conflicting
  outcomes keep both pieces of evidence instead of letting the last one win.
  Three edge cases were settled in review rather than by the owner, and the
  owner may revisit them: a conflict opens or reopens the operation's one
  item, a late outcome after handling updates only the tracker and history,
  and a reused `(source, id)` is a faulty message with no inbox item.
  [#782](https://github.com/jimmie-potts/agent-device-hub/issues/782) and
  [#923](https://github.com/jimmie-potts/agent-device-hub/issues/923)
  implement it.
- **Failure isolation follows policy A.** The record listed device timeouts
  among module failures, contradicting the owner's policy A of 2026-10-06
  ([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919)).
  Device errors and timeouts are outcomes and device state; only an error that
  escapes a module stops it. The `bunny-runtime` specification is corrected to
  match.
- **No `tracestate`.** The envelope listed an optional `tracestate`, which the
  diagnostic contract had already disabled. Profile 2.0 drops it, and #948
  removes it from the schema and the SDK.
- **Observability** now separates correlation from recorded spans, records each
  decision once where it is made, and sets levels, repetition and bounds.
  Recorded spans reuse the observability package's host adapter instead of a
  second implementation, with no exporter until #813.
  [#949](https://github.com/jimmie-potts/agent-device-hub/issues/949) owns the
  new instrumentation, because #813 excludes it.

**2026-10-08, fresh setup without data migration.** The owner selected fresh
runtime state, manually selected configuration and expected downtime for
[#935](https://github.com/jimmie-potts/agent-device-hub/issues/935) and
[#840](https://github.com/jimmie-potts/agent-device-hub/issues/840). The
[fresh setup procedure](../../apps/runtime/SETUP.md) replaces the original
backup, transfer, conversion and migration-verification plan. Existing tools
remain available but are not steps or gates for this cutover. Old services,
files and releases stay untouched for manual return; only one set of writers
runs at a time. One owner-present setup and smoke check completes the installed
step. Retirement is optional follow-up work with separate scope, rather than a
gate for this delivery. This amendment does not authorize installed discovery,
service changes or physical device commands before the owner's #840 window.
