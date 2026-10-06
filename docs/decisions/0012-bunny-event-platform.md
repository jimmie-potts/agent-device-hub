# ADR 0012: One event and messaging platform for every component

Status: accepted on 2026-10-05, amended on 2026-10-06 (see [Amendments](#amendments)).
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
Log and trace conventions also follow it. Any new or changed communication
between components follows this ADR.

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
- A module imports only the SDK and the contracts packages, never another
  module.
- **Failure isolation:** a module's thrown errors, rejected promises and device
  timeouts stop only that module, which shows as unhealthy. A blocked event loop
  or memory exhaustion affects the whole process, so the service manager
  restarts the runtime.
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
  in the shared error body.
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

Device commands, moments, mode changes and inbox notices are tracked:
- The core records each one as sent, then accepted when the reply arrives, then
  completed when the outcome arrives.
- If its deadline passes first, the core records it as uncertain. A command
  still queued at its deadline never reached the owner, so the SDK answers it
  `expired` instead; the core records only an unknown fate as uncertain. Failed
  and uncertain results go to the shared inbox.
- Every step is logged.
- A timed-out command is never retried automatically.
- The core claims a physical change only when the device reported an observation.

State events and telemetry are not tracked.

### Inbox and history

- One shared inbox in the core holds turn-ended notices and failed or uncertain
  operations. Items survive restarts until handled, with no expiry and no
  automatic clearing. Handling an item once clears it everywhere; dismissing it
  on a display is a separate fact.
- Long-term history is private SQLite in the core store, with no time limit, a
  dashboard timeline and a read API. Viewing history never triggers devices or
  automation.
- When the disk is full, the core refuses durable work before it reports
  anything accepted.

### Envelope and conventions

- Every message is CloudEvents 1.0 structured JSON under B.U.N.N.Y. profile 2.0.
  Its attributes are `specversion`, `bunnyprofile`, `id`, `source`, `type`,
  `subject` (the event subject), `time`, `kind` (the message kind),
  `datacontenttype`, `dataschema` and `traceparent`, with optional
  `tracestate`. Commands and sync requests also carry `expiresat`, and no other
  kind may. Profile 1.0's `deliveryclass` is gone: `kind` replaces it.
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

### Observability

- Every HTTP call and every message carries W3C trace context. Each component
  starts a child span when it receives work.
- Every log line carries `trace_id` and `span_id` under the
  [diagnostic contract](../observability-contract.md), so one request can be
  followed through every component.
- Telemetry is never acknowledged. Its existing bounded queues can drop records
  under pressure. The diagnostic contract makes that loss visible.
- Viewing traces in Grafana belongs to
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
  and sees only the current state after its sync. The shared inbox and history
  are where missed occurrences remain visible.
- Live-only commands: a command to an offline module is lost, not queued. The
  owner sees it as failed or uncertain and can resend it.
- Tracking: each tracked kind needs a deadline. Uncertain items need a person to
  decide, because nothing retries them automatically.
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
