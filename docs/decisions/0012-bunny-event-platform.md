# ADR 0012: One event and messaging platform for every component

Status: accepted on 2026-10-05. Supersedes [ADR 0010](0010-shared-event-contracts.md).
Delivery: [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827).

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
one format everywhere. The owner wants this delivered before other feature work.
The one exception is the CHOMPI agent-controls integration already in progress.

## Decision

### Scope and adoption

This decision covers every message that crosses a component boundary in Hub,
Nanoleaf, Pixoo and future repositories: events, commands, replies and errors.
Log and trace conventions also follow it. Any new or changed communication
between components follows this ADR.

Existing formats move by full cutover:
- Each contract gets a 2.0 version that follows these conventions.
- Each component moves in its own delivery, with a short period where both
  versions work.
- The 1.x formats, routes and controller HTTP command ports are removed once
  every installed consumer runs 2.0.
- Released 1.x artifacts stay unchanged until that removal.

### Broker

- NATS JetStream is the message bus. One `nats-server` runs as a user service on
  the runtime host and listens on loopback only.
- Each service has its own credentials, limited to the subjects it owns or reads.
- Stream, retention and limit configuration lives in this repository.
- The bus works without internet access.

### Message kinds

- **State events** say what an entity looks like now. Each one carries the
  complete current record of one entity (a session, the mode, an inbox item, the
  playback state), never a diff. Consumers replace their copy. The broker keeps
  only the latest state event per bus subject.
- **Occurrence events** say what happened, such as `attention.raised`,
  `attention.cleared`, `turn.ended` or a controller outcome. They matter even
  when the state later looks the same. The broker holds them until the durable
  readers store them, for at most 24 hours.
- **Commands** are live-only requests to one owner on its command subject. They
  carry an expiry, are never stored and never replay after a restart.
- **Replies** answer a command immediately with `accepted` or with a rejection
  in the shared error body.
- **Outcomes** are occurrence events that complete a command: `succeeded`,
  `failed` or `uncertain`, with evidence `transmitted` or `observed`.

### Ownership and publication

- One owner publishes each fact, and one writer controls each device. The Hub
  state owner stays authoritative. This is not event sourcing.
- An owner writes its events to an outbox in the same transaction as its state
  change. A relay publishes them and marks them sent after the broker stores
  them, so a crash or broker outage loses nothing and never blocks the commit.
- Agent hooks stay bounded and fail-open, and keep posting to the Hub. The
  dashboard and MCP clients reach only the Hub, over HTTP. Vendor adapters that
  must poll (Sony, Sonos) publish what they observe.

### Consumers and recovery

- Each consumer keeps its own local store built from the events it receives,
  using the shared client library's store and checkpoint.
- A consumer starts from the latest state event per subject, then follows live
  events. It drops duplicates and stale revisions, and ignores commands or
  effects past their expiry.
- This delivery has no replay of any kind:
  - no rebuild from the log;
  - no history replay into views;
  - no catch-up for displays.
- Only the history store and the Hub's tracker of high-impact messages read
  durably. A slow consumer lags only itself.

### High-impact messages

Device commands, moments, mode changes and inbox notices are tracked:
- The Hub records each one as sent, then accepted when the reply arrives, then
  completed when the outcome arrives.
- If its deadline passes first, the Hub records it as uncertain. Failed and
  uncertain results go to the shared inbox.
- Every step is logged.
- A timed-out command is never retried automatically.
- The Hub claims a physical change only when the device reported an observation.

State events and telemetry are not tracked.

### Inbox and history

- One shared Hub inbox holds turn-ended notices and failed or uncertain
  operations. Items survive restarts until handled. Handling an item once clears
  it everywhere; dismissing it on a display is a separate fact.
- Long-term history is a private SQLite store fed from the bus, with no time
  limit, a dashboard timeline and a read API. Broker retention is not history.
  Viewing history never triggers devices or automation.

### Envelope and conventions

- Every message is CloudEvents 1.0 structured JSON under B.U.N.N.Y. profile 2.0.
  It adds `subject` (the event subject), `traceparent` and, for commands and
  effects, `expiresat` to the profile 1.0 attributes.
- Messages are capped at 256 KiB, enforced by the broker and the validators.
  Larger content stays in its owner's store, and the message carries its ID,
  size and hash.
- Event types are named `org.bunny.<entity>.<past-tense verb>`. Command types
  are named `org.bunny.<entity>.<verb>.requested`.
- Bus subjects are named `bunny.<state|event|cmd>.<family>.<id>`: lowercase,
  shallow, with hyphens inside tokens. "Bus subject" means the NATS routing key;
  "event subject" means the CloudEvents `subject` attribute.
- One error body serves HTTP responses, MCP tool results, command replies and
  validators:
  `{"error": {"code", "retryable", "requestId", "traceId", "detail"}}`.
  - Codes are kebab-case and come from one registry in the contracts package.
  - `detail` is optional; `requestId` and `traceId` appear when known.
  - MCP protocol errors keep the MCP specification.
- Each document carries one schema identifier, `<family>/<major>.<minor>`:
  messages in `dataschema`, HTTP and stored documents in `schema`. Routes carry
  only the major version.
- JSON fields are camelCase. Log records keep OpenTelemetry field names as the
  one deliberate exception.
- Envelope `time` is RFC 3339 UTC with milliseconds. Payload instants are
  integer `<name>AtMs`.

### Observability

- Every HTTP call and every message carries W3C trace context. Each component
  starts a child span when it receives work.
- Every log line carries `trace_id` and `span_id` under the
  [diagnostic contract](../observability-contract.md), so one request can be
  followed through every component.
- Telemetry is never acknowledged and may drop under pressure.
- Viewing traces in Grafana belongs to
  [#813](https://github.com/jimmie-potts/agent-device-hub/issues/813).

### Portability

Services use only the shared TypeScript and Python client library: publish,
load latest and follow, durable subscribe, request and respond. They never use
a NATS client directly, which keeps a later move to AWS cheap. To support that:
- Everything a consumer needs lives in the message body.
- Duplicate handling, ordering and expiry live in the envelope and the consumer,
  not in broker features.
- Loading current state is an interface. The Hub keeps a snapshot read API as a
  second implementation.
- The outbox and the history API do not depend on the broker.

A later move would replace one adapter per language (for example SNS and SQS
with a DynamoDB latest-record table). Only data stores and services that never
touch local devices are candidates for cloud hosting. Controllers and fast
reactions stay on the home network.

### Personal data

Profile 2.0 drops profile 1.0's privacy-based field exclusions.
[ADR 0011](0011-private-personal-data-retention.md), as amended on 2026-10-05,
governs personal data:
- It stays on this machine.
- It may be used in Claude and Codex prompts.
- It never goes to GitHub.

Credentials, tokens and secrets never enter messages, logs or history.

## Alternatives and consequences

These alternatives were rejected:
- **A durable log hosted in the Hub.** We would have to build consumer
  positions, redelivery and retention ourselves.
- **Staged, need-only adoption (ADR 0010).** It produced no adopter while new
  formats kept appearing.
- **Fine-grained change events only.** Every consumer would have to rebuild the
  Hub's state logic in two languages.
- **A whole snapshot in every event.** It would exceed the size cap.
- **AWS SNS and SQS now.** They would add an internet round trip and an internet
  dependency to every device reaction. They also lack latest-value and
  request/reply primitives.
- **Event sourcing.** Deferred to a later deliberate decision.

The consequences:
- An always-on broker becomes a dependency. If it is down, consumers stop
  receiving and commands fail; owners keep committing, and the outbox drains
  when the broker returns.
- The cutover touches every component in three repositories, and working
  features can regress during it. Each step is installed and checked before the
  next.
- Consumer views are eventually consistent, so every consumer must handle
  duplicates and lag.
- Broker data, consumer state, history and backups add operational work.
- Feature work pauses until the epic completes, except the CHOMPI integration.

Reassess if a device cannot keep its behavior under the cutover, if the runtime
moves hosts or to the cloud, or if a second operator or remote access is
selected.
