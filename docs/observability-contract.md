# Shared diagnostic contract

[ADR 0011](decisions/0011-private-personal-data-retention.md) changes the accepted
direction for private diagnostics: retain personal context locally and keep it
out of GitHub. The profiles below describe the released contract, including its
current exclusions. Richer capture and durable retention require a versioned
implementation with consumer and exporter checks; this policy decision does not
widen an existing schema or export destination.

The artifact `@jimmie-potts/bunny-observability` version 1.1.0 owns this contract,
its JSON Schema, catalog, fixtures and language helpers. The B.U.N.N.Y. profiles
1.0 and 1.1 are independent of the pinned OpenTelemetry semantic conventions
1.44.0. Both profiles are introduced together: 1.0 is the minimal compatibility
profile; 1.1 adds optional `bunny.queue.depth`. This is not a claim that an older
artifact was deployed. The default producer profile is 1.1.

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
| `schema_version` | Required, `1.0` or `1.1` | Log attribute `bunny.schema.version`, string |
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
  day. Queue depth is 0–1,024 in profile 1.1 only.
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

## Traces and context

Use registered short spans: `bunny.command.request`, `bunny.command.queue`,
`bunny.command.execute`, `bunny.lifecycle.observe`, `bunny.feed.read`,
`bunny.process.start`, `bunny.helper.run`. Names never contain IDs or content.
Use the same approved resource/scope/attribute dictionary for spans. The host
owns the OTel SDK, ID generation, sampling and exporter; the shared library starts
none. Host adapters must filter SDK-generated attributes/events too: default
HTTP instrumentation and exception recording can otherwise bypass this policy.

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
OTLP logs; host OTel SDK spans go to OTLP traces. Both reach the configured local
collector. Canonical stderr may also serve local diagnostics, but do not scrape
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
