# Shared diagnostic contract

[ADR 0011](decisions/0011-private-personal-data-retention.md) changes the accepted
direction for private diagnostics: retain personal context locally and keep it
out of GitHub. The profiles below describe the released contract, including its
current exclusions. Richer capture and durable retention require a versioned
implementation with consumer and exporter checks; this policy decision does not
widen an existing schema or export destination.

The artifact `@jimmie-potts/bunny-observability` version 1.3.0 owns this contract,
its JSON Schema, catalog, fixtures and language helpers. The B.U.N.N.Y. profiles
1.0, 1.1, 1.2 and 1.3 are independent of the pinned OpenTelemetry semantic
conventions 1.44.0. Profiles 1.0 and 1.1 were introduced together: 1.0 is the minimal
compatibility profile; 1.1 adds optional `bunny.queue.depth`. This is not a
claim that an older artifact was deployed. Profile 1.2 registers the B.U.N.N.Y.
runtime ([#903](https://github.com/jimmie-potts/agent-device-hub/issues/903));
see [The runtime's records](#the-runtimes-records-profile-12). Profile 1.3
registers its decision records and span names
([#949](https://github.com/jimmie-potts/agent-device-hub/issues/949)); see
[Decision records and spans](#decision-records-and-spans-profile-13). The default
producer profile stays 1.1: existing producers keep it, and a producer selects
1.2 or 1.3 explicitly.

The machine-readable dictionary is `src/record.schema.json` and the registered
vocabulary is `src/catalog.json` in the artifact. These files and this document
are normative. Changes require contract review, cross-language fixtures and
packaged-consumer checks before dependent instrumentation consumes them.

## Record and transport fields

Canonical local output is UTF-8 NDJSON, one JSON object and one newline per
record. Raw Pino or Python logging output is not another supported dialect.
Objects are closed; arrays and arbitrary nested values are excluded. Optional
fields are omitted, never null. A record including its newline is at most 8 KiB.
Invalid or oversized records are dropped whole, never truncated into misleading
identities or private fragments. A normalizer discards unknown keys before any
serialization; the strict validator rejects them.

| Local field | Requirement and type | OTLP JSON mapping |
| --- | --- | --- |
| `schema_version` | Required, `1.0`, `1.1`, `1.2` or `1.3` | Log attribute `bunny.schema.version`, string |
| `timestamp` | Source time if known | `timeUnixNano`, decimal integer string |
| `observed_timestamp` | Receiver time if applicable; at least one time required | `observedTimeUnixNano`, decimal integer string |
| `severity_number`, `severity_text` | Required, matching registered pair | `severityNumber`, `severityText` |
| `event_name`, `body` | Required registered event and its exact static text | `eventName`, `body.stringValue` |
| `resource` | Required closed resource dictionary | `resourceLogs[].resource.attributes` |
| `scope` | Required registered name and version | `scopeLogs[].scope` |
| `attributes` | Required, at most 32 registered scalar values | Sorted OTLP attributes with typed AnyValue |
| `trace_id` | Optional nonzero lowercase 32 hex digits | `traceId` |
| `span_id` | Optional nonzero lowercase 16 hex digits; requires trace ID | `spanId` |
| `trace_flags` | Optional two lowercase hex digits; requires trace ID | Numeric `flags` |

Times use UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, calendar-valid, no earlier than the Unix
epoch and no later than `2554-07-21T23:34:33.709Z`, the last whole
millisecond representable by OTLP uint64 nanoseconds. Milliseconds are preserved exactly as decimal nanosecond strings in OTLP;
JavaScript never holds epoch nanoseconds in a Number. Missing source time stays
missing even when observed time exists. Durations use the local monotonic clock;
never subtract unrelated process clocks. OTLP scope groups carry
`schemaUrl: https://opentelemetry.io/schemas/1.44.0`.

| Severity | OTel | Pino | Python |
| --- | --- | --- | --- |
| TRACE | 1 | 10 | 5 (explicit custom level) |
| DEBUG | 5 | 20 | 10 |
| INFO | 9 | 30 | 20 |
| WARN | 13 | 40 | 30 |
| ERROR | 17 | 50 | 40 |
| FATAL | 21 | 60 | 50 |

Unmapped native levels are rejected. Severity describes diagnostic importance;
span status describes execution failure; neither rewrites domain outcomes.
Denial, cancellation, partial delivery, transport acknowledgment and uncertainty
remain distinct. A transport acknowledgment never establishes physical success.

## Identity, vocabulary and privacy

Resources require `service.namespace=bunny`, a registered `service.name`, a
`service.version` (bounded semver or `unknown`), a neutral UUID
`service.instance.id`, and `deployment.environment.name` (`development`, `test`
or `production`). Keep authoritative build versions when available; a placeholder
package version is not invented build evidence. Optional `bunny.build.revision`
is a 40-character lowercase commit hash. Existing build-metadata work stays
independent. A library inherits its host resource and selects its registered
scope. Process instances get separate neutral UUIDs; browser instances use
neutral ephemeral IDs, never account/session names.

`catalog.json` enumerates services, scopes, events, static bodies, span names and
every attribute's exact type/bound. Common operations include startup/shutdown,
brightness, power, mode, status, feed, lifecycle, automation, playback, media,
storage, setup, verification and maintenance. Event examples cover process start,
command admission/rejection/queue/execution/completion/cancellation, lifecycle
observation, feed changes, operation completion/failure and telemetry loss.

Approved attributes keep these identities separate:

- `bunny.request.id` identifies an application request; controller tickets use
  `bunny.ticket.epoch` and numeric `bunny.ticket.sequence`.
- `bunny.controller.id`, `bunny.device.id`, `bunny.source.id` are neutral configured
  identifiers, not private display names or endpoint addresses.
- `bunny.operation.id`, task/effect/clock epochs, generation, state/source revision
  retain their owning semantics. Integers are nonnegative safe integers.
- Duration and queue wait fields are nonnegative milliseconds, bounded to one
  day. Queue depth is 0-1,024, from profile 1.1.
- `bunny.operation`, `bunny.outcome`, `bunny.reason` use registered enums.
  `bunny.write.possible` preserves uncertain side effects.
- `bunny.provenance=source` describes an emitter's own event. A receiver's
  observation requires `bunny.provenance=observation` and
  `bunny.observed.service`; it never claims to be the observed emitter.

Identifiers have at most 128 ASCII characters from the schema's neutral-ID
alphabet. Syntax does not prove privacy: producers must select approved machine
identities, never sanitize private text into an apparently valid ID. Exclude
credentials, tokens, headers, bodies, payloads, prompts, transcripts, agent output,
media, session/project names, raw paths/URLs and raw exception messages/stacks.
Do not capture arbitrary objects, console output, DOM/text or browser replay.
Map errors to registered reason codes. Unknown values are not stringified.
No private data in baggage; baggage and tracestate propagation are disabled.

## The runtime's records (profile 1.2)

Profile 1.2 is profile 1.1 plus the runtime's vocabulary. The catalog's
`additions` lists what each profile adds, and every earlier profile rejects it,
so a 1.2 record that uses it never projects to 1.1 or 1.0. The additions:

- **Service:** `runtime`, the one runtime process of
  [ADR 0012](decisions/0012-bunny-event-platform.md).
- **Scopes:** `bunny.runtime` for the runtime's own records, and `bunny.module`
  for every module's. There is one module scope, not one per module: the
  `bunny.module` attribute names the module. Both scopes belong to the `runtime`
  service, and each allows only the events its entry in the catalog's
  `scope_rules` lists. A `bunny.module` record must name its module. The
  runtime's own events, `runtime.*`, appear only under `bunny.runtime`.
- **Runtime events:** start, ready, stop and failure (`runtime.started`,
  `runtime.ready`, `runtime.stopped`, `runtime.failed`), the event-loop lag check
  (`runtime.stuck`, `runtime.watchdog.failed`, `runtime.watchdog.stopped`),
  module lifecycle (`runtime.module.refused`, `.starting`, `.started`,
  `.failed`, `.error-after-stop`, `.stop-timed-out`, `.stop-failed`,
  `.stopped`), a failed handler outside every module
  (`runtime.handler.failed`), dropped deliveries
  (`runtime.delivery.dropped`) and the SDK edge (`runtime.edge.serving`,
  `.connected`, `.disconnected`, `.refused`).
- **Module events:** a module may log the existing command, lifecycle, feed and
  operation events, and three new ones: `message.received` (a consumer took a
  message once by `(source, id)`, as a duplicate, or refused a conflict),
  `outbox.republished` and `outbox.acknowledged`.
- **Attributes:** `bunny.module` (a module name), `bunny.participant` (an SDK
  participant source such as `bunny/modules/lamp`), `bunny.pattern` (a routing
  pattern or `sync <families>`), `bunny.code` (a code from the 2.0 error
  registry), `bunny.phase` (where a module's refusal, failure or stop problem
  arose), counts (`bunny.module_count`, `bunny.delivery.dropped_count`,
  `bunny.outbox.republished_count`, `bunny.grant_count`), durations
  (`bunny.timeout_ms`, `bunny.lag.duration_ms`, `bunny.lag.limit_ms`),
  `bunny.exit_code`, `bunny.message.id` (the 2.0 message id), `bunny.message.kind`,
  `bunny.simulate` and `bunny.edge` (whether modules are simulated and the edge
  configured), `bunny.route` (one of the edge's routes, or `other`), the
  OpenTelemetry `server.port`, and
  the OpenTelemetry `error.type` with its plain `error.code`. `error.type` and
  `error.code` are identifiers of at most 64 characters, never a message. A
  record carries a listener's port, never its URL. An edge refusal carries its
  registry code and, as the existing `bunny.reason`, that code's fixed
  registered reason, never the refusal's detail.

A new runtime or module event or attribute is a catalog change: a new profile or
an unreleased one, with fixtures, contract review and the packaged-consumer
checks. Building a record keeps only the attributes its own profile registers,
so a default profile 1.1 record leaves out a 1.2 attribute. The Python helpers
validate and convert profile 1.2 and 1.3 records from the schema and catalog; they
produce profile 1.1 by default and project only to 1.0 and 1.1, since Python
producers stay on 1.1.

## Decision records and spans (profile 1.3)

Profile 1.3 is profile 1.2 plus the records and span names that ADR 0012's
"Observability" section needs to record each decision once, where it is made
([#949](https://github.com/jimmie-potts/agent-device-hub/issues/949)). Every
earlier profile rejects each addition. The additions:

- **The bus's decisions,** under `bunny.runtime`: a command admitted to its
  owner's queue (`runtime.command.admitted`), refused by the bus for no
  responder, a full queue, its expiry or a closed responder
  (`runtime.command.refused`), cancelled before a handler started it
  (`runtime.command.cancelled`), replied to by its owner, accepted or with its
  typed refusal (`runtime.command.replied`), or left `uncertain-result`
  (`runtime.command.uncertain`); and a sync served, refused or restarted after
  an overflow (`runtime.sync.served`, `.refused`, `.restarted`).
- **The edge's unexpected exception,** `runtime.edge.failed`, at ERROR with
  only its route, its granted source if any, the code it answered (`internal`,
  or `uncertain-result` once it had handed a command to the bus) and
  `error.type`; after dispatch, also the command's `bunny.routing.key`,
  `bunny.request.id`, `bunny.message.id` and trace.
- **Tracing that cannot start,** `runtime.tracing.failed`, at ERROR with only
  `error.type`, once, when the runtime runs without recorded spans.
- **Module events:** an outcome's first publication from a module's outbox
  (`outcome.published`), a run of publishes refused after their commits
  (`outbox.deferred`), and a device that stops or starts answering
  (`device.unavailable`, `device.available`).
- **Attributes:** `bunny.routing.key` (an SDK routing key, never a pattern, of
  at most 512 characters), `bunny.outbox.waiting_count` (the messages a refused
  send left behind) and `bunny.attempt_count` (failed attempts or repeated refusals, summarized).
- **Span names:** `bunny.outcome.publish` and `bunny.device.call`. The catalog's
  `additions` list them too, since a span name is vocabulary.

`bunny.request.id` keeps profile 1.0's pattern, which is stricter than the 2.0
`requestId`: a producer leaves out a request ID that the pattern refuses, rather
than lose the record, and keeps the record's trace and message ID. Every ID the
SDK generates matches.

## Traces and context

Use registered short spans: `bunny.command.request`, `bunny.command.queue`,
`bunny.command.execute`, `bunny.lifecycle.observe`, `bunny.feed.read`,
`bunny.process.start`, `bunny.helper.run`, and from profile 1.3
`bunny.outcome.publish` and `bunny.device.call`. Names never contain IDs or
content. Use the same approved resource/scope/attribute dictionary for spans. The
host owns the OTel SDK, ID generation, sampling and exporter, or its bounded
local span sink; the shared library starts none. Host adapters must filter
SDK-generated attributes/events too: default HTTP instrumentation and exception
recording can otherwise bypass this policy.

A request span ends when the response/admission decision is complete. Queue and
execution spans describe their own bounded work. Carry context explicitly only
through owned handoffs; use span links for deferred work and lifecycle
observations. If context is absent, preserve the ticket and emit an untraced
record or a new root; never fabricate a parent. Long-running workers create
per-operation spans. SSE/feed connections use bounded read/delivery spans and
new reconnect attempts, not a session-long span. Async context is scoped and
restored on completion or exception. Python threads/processes and persistent
queues need explicit capture/restore; a ContextVar alone does not cross them.

Accept version-00 W3C traceparent only after authentication and boundary ownership
checks; malformed/absent input is ignored. Context is metadata, never permission
or admission authority. Reserved flag bits are preserved as metadata; the OTel
SDK decides sampling from the sampled bit. No context crosses vendor/device
boundaries by default. Do not add fields to closed controller/lifecycle wire
envelopes. Use qualified transport metadata or owned queue sidecars, separately
versioned if necessary. Receiver observations remain distinct from source logs.

## Ingestion and queries

One host-owned path per signal: canonical Pino/Python records are converted to
OTLP logs; host OTel SDK spans go to OTLP traces, to the host's bounded local span
sink, or to both. Both signals reach the configured local collector when there is
one. A local span sink receives the same projected OTLP span through the same
bounded queue, so tracing needs no collector. Canonical stderr may also serve local diagnostics, but do not scrape
it into the same backend when OTLP logs are enabled: that duplicates records.
Browser producers send approved bounded records to their authenticated same-origin
backend, which validates them before export. Browsers hold no exporter credentials.
Hooks remain silent; receiving owners emit observations on a separate channel.
Machine-readable stdout, domain journals and transport-proof receipts keep their
existing contracts and retention.

Map OTLP logs to Loki and traces to Tempo in the pilot. Loki stream labels are
limited to namespace, service name and environment. Keep version, instance ID,
trace/span IDs, tickets and request IDs as searchable structured metadata, not
stream or metric labels. Preserve `bunny.*` attribute names/types through the
collector's configured mapping. Grafana log-to-trace links use `trace_id` to open
the corresponding Tempo trace. Queries select service, event, trace ID, ticket
and outcome fields; never parse `body`. The executable query fixture demonstrates
these joins across both languages/profiles. Actual backend mapping, ingestion,
queries and duplicate detection must be qualified by the pilot.

## Bounded behavior and compatibility

Executable hosts default to INFO-and-above local diagnostics. Libraries default
to no-op; hooks remain silent. Tracing/export require explicit enablement. Pilot
sampling is 100%; later enabled tracing defaults to 10% head sampling. No exporter,
listener, file, worker or network request starts merely by importing this artifact.
Python definitions load lazily on first use.

Each signal has at most 1,024 records or 4 MiB queued, whichever fills first;
active output remains counted. Drop newest. Keep bounded safe counters for
accepted, dropped, failed, queued and bytes; never recursively emit a failure
into the failing sink. Counters saturate at JavaScript's maximum safe integer.
Shutdown telemetry flush is at most one second, then pending work is dropped.
An in-flight host callback may retain one bounded record until it returns; hosts
must bound/cancel transport work independently. Never retry/spool device commands,
change authentication/queues or propagate telemetry failure into domain behavior.
No domain journal retention change is included. Pilot storage is bounded and
removed after evidence capture; only synthetic evidence is retained.

Closed profiles require explicit projections. Profile 1.0 rejects queue depth;
projecting 1.1 to 1.0 removes it while preserving all common fields. Unsupported
versions fail closed for diagnostics and fail open for product behavior. New
optional fields/catalog extensions require a new profile and fixtures, not silent
export. Required/type/meaning changes require a breaking profile and migration
plan. Artifact semver, profile version and OTel conventions are independently
pinned. No producer auto-upgrades, and published artifact bytes are immutable.

Budget review is required after queue drops, resource-cap failures, material
component/event-volume growth or runtime/host changes. Revised budgets need a
recorded rationale and fresh reviewed measurements. Never retroactively turn a
failed pilot into a pass by changing its thresholds.

## Adoption boundary

The following are source inventory boundaries, all **not yet adopted** by this
contract delivery. Ownership means source responsibility, not installation.

| Repository owner | Components and planned seam |
| --- | --- |
| Hub | Hub HTTP/MCP host and command routes: authenticated request metadata, admission/queue/execution records; preserve ready-line stdout. |
| Hub | Contracts, MCP, agent-state/status/lifecycle libraries: injected no-op emitter, host resource, no exporter. |
| Hub | Local-controller host, Tidbyt/LIFX runners: host sinks and queue context; vendor/LAN calls suppress tracing headers. |
| Hub | Dashboard/browser: registered operation/error metadata through authenticated bounded backend route; no visible UI change. |
| Hub | Provider/hook receiver: receiver observations; hooks remain bounded, silent and fail-open. |
| Hub | Setup, app verification, host routing, performance/compatibility and delivery/maintenance helpers: separate operational channel; preserve machine receipts/IPC. Retired tools remain retired. |
| Pixoo | Fastify backend, controller queues, playback/automation/media/storage: host identity, bounded sink and explicit context. |
| Pixoo | Web UI and simulator: authenticated browser relay; preserve exact simulator readiness banner and transport-guard proof format. |
| Pixoo | Detached media worker and operational helpers: explicit bounded IPC/context and owned sink; preserve worker resource bounds and result formats. |
| Nanoleaf | Python controller, CLI/MCP, detached worker and SQLite queue: explicit context/links across process boundaries and a bounded sink despite discarded stdout/stderr. |
| Nanoleaf | Wall server/browser: authenticated same-origin rate-limited relay preserving CSP/token checks; no visible UI change. |
| Nanoleaf | Copied runtime/bridge vendor layouts and helper tools: immutable artifact receipt in each packaging boundary; preserve helper output. |

Profile 1.2 adopts the B.U.N.N.Y. runtime in source: its own records and its
modules' are contract records on stderr. Profile 1.3 adds its decision records,
and the runtime records its spans to a bounded local span sink, with no exporter
(#949). The runtime and its journal intake are
installed at the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)); OTLP
export and viewing are [#813](https://github.com/jimmie-potts/agent-device-hub/issues/813).

Generated static documentation/media artifacts emit no runtime diagnostics. Maintained
helper processes may emit operational metadata on a separate channel; raw compiler,
subprocess and third-party tool output is not automatically captured or exported.
Retired automation remains retired and is not an adoption target.

External devices, firmware and third-party services are observed only at owned
boundaries. No internal coverage is claimed. Pilot findings must refine adoption
seams and validation before source adoption; issue trackers own delivery sequence,
dependencies and current status. Contract completion alone is not system coverage.

## References

This profile follows the [OTel log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/),
[resource conventions](https://opentelemetry.io/docs/specs/semconv/resource/),
[non-OTLP context mapping](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
and [W3C Trace Context](https://www.w3.org/TR/trace-context/).
