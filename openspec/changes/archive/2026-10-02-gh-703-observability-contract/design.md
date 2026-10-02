## Context

See proposal.md for the outcome and exact issue. Design is required by the spec-driven schema because this contract crosses languages and packages and governs privacy, concurrency, compatibility and bounded failure.

The owner accepted the contract/package direction, privacy and propagation policy, enablement/volume limits, and browser/worker/helper direction on 2026-10-01. The current repositories use strict versioned archives, independent language fixtures and host-owned lifecycle. Existing machine-ready output, IPC, proof receipts and domain journals have separate consumers and authority.

## Goals / Non-Goals

**Goals:** a small immutable profile artifact with identical query semantics, strict validation, safe record construction/conversion, explicit context handling, bounded optional sinks and independently executable language/consumer fixtures.

**Non-Goals:** product instrumentation, autonomous exporters, collectors, logs as authorization/audit/replay, wire-envelope changes, live settings/state/devices, UI changes or content capture. Those boundaries also apply when a shared library is imported.

## Decisions

### One artifact and one semantic catalog

Use `packages/observability` and `@jimmie-potts/bunny-observability`, with schema/catalog/fixtures, browser-safe TypeScript core, explicit Node/Pino adapter and Python helpers. Hosts inject resource identity and sinks. No import starts I/O or an exporter. The existing manifest/archive/checksum/source-receipt convention supplies external consumers; separate language releases would make conformance and pins harder to coordinate.

The normative dictionary is `docs/observability-contract.md`; package README documents APIs and limitations. Pin OTel semantic conventions independently (upstream v1.44.0 at discovery), along with source links to the log model, non-OTLP correlation and W3C Trace Context. Exact Pino dependency is 10.3.1, also present transitively in current Pixoo. Do not add a full tracing SDK merely to validate the contract; live SDK/ESM/exporter compatibility belongs to the pilot.

### Canonical records, static vocabulary and exact conversion

Emit UTF-8 NDJSON with `schema_version`, millisecond UTC RFC3339 timestamps, OTel `severity_number`/`severity_text`, registered `event_name`, static catalog `body`, `resource`, `scope`, approved `attributes`, and optional qualified top-level trace/span/flags. Unknown source time is omitted with observed time retained; null is not a substitute. Durations are finite nonnegative values measured by a local monotonic clock. Conversion uses decimal strings for nanosecond OTLP JSON values, never unsafe JavaScript numeric integers. Accepted times end at 2554-07-21T23:34:33.709Z so every value fits OTLP uint64 nanoseconds. Both languages distinguish omitted versions from explicit null and select only a fixed set of input keys. Resource/scope semver values preserve bounded build metadata.

Register operation-oriented event/span names for process lifecycle, admission, queue/execution, outcomes, cancellation, provider observations, feed availability, helper outcomes and telemetry loss. Keep severity, span status, domain outcome, transport acknowledgment and physical proof separate. Preserve request IDs, controller/device/source IDs, ticket epoch/sequence, operation IDs, revisions and task/effect epochs in distinct typed fields. Use the OTel severity anchors TRACE1/DEBUG5/INFO9/WARN13/ERROR17/FATAL21 with explicit Pino/Python maps.

Executable resources use namespace bunny, registered neutral service names, a supplied version or unknown, random process instance identity and explicit environment. Preserve an available authoritative build revision without inventing it from state revision or package placeholder version. Libraries use registered scopes under the host resource. Receiver observations identify observer and observed source separately and never claim emission that was not seen.

### Strict privacy boundary

The owner accepted static event/body text, typed allowlisted metadata and omission of session/project identity. Credentials, tokens, payloads, prompts/transcripts, titles, media, raw paths/URLs, raw exception messages/stacks and arbitrary object serialization are excluded. Output construction projects only known fields; validation rejects unknown fields on canonical records. Bad values, versions and oversized records are dropped with a fixed safe reason, never a dump of the input. A malformed optional attribute cannot become free-form text.

Apply the same projection before local output and export. Redaction is a structural allowlist, not a claim that arbitrary strings can be classified as secrets. Hosts must supply neutral configured identifiers and validated machine identities, not user labels disguised as IDs. Negative fixtures exercise payload/header/query/error locations and nested unknown fields. No blanket Pino/Fastify serializers, console capture or automatic exception recorder is enabled.

### Trace context is bounded diagnostic metadata

Validate lowercase nonzero W3C IDs and complete trace/span/flags relationships. Untraced logs omit context; they do not fabricate parents. A helper accepts traceparent only for an authenticated, explicitly owned boundary, strips baggage/tracestate and suppresses outbound propagation to device/vendor destinations. It never authenticates a caller or edits a controller/lifecycle body. Missing/malformed context yields a neutral absence.

Node async context and Python explicit context capture/restore must isolate concurrent operations. A queue handoff carries immutable context explicitly and restores the previous context after success/failure. Short request, queue and execution spans may link deferred work; feeds record short reconnect/read observations, not an indefinite session span. Cross-process transport adapters remain host-owned and separately tested during adoption; missing context retains ticket-based correlation without invented parentage.

### Bounded optional emission

Libraries are no-op by default; executable adoption will use local INFO-and-above records with tracing/export opt-in. Silent hooks remain silent and receiving owners report what they observe. No per-frame INFO output. The accepted maximum is 8 KiB per encoded record and 1,024 records or 4 MiB per signal queue, whichever is reached first. Drop newest on saturation with bounded safe counters; do not spool/retry commands. Shutdown flush gets at most one second and does not propagate sink errors into product work. Caller-owned product deadlines are not extended by exporter waits.

The contract helper accepts a nonblocking host sink and guards exceptions/rejections. It cannot make an arbitrary synchronous user callback nonblocking: the host adapter must meet that contract. Tests use stalled, throwing and rejecting sinks and prove bounded retained work and shutdown. Diagnostic loss never claims service inactivity, unread acknowledgment or physical success.

Pilot traces use 100% sampling; later explicitly enabled tracing defaults to 10% head sampling. These are source defaults, not permission to switch a running installation. Existing journal retention is unchanged. The pilot removes owned storage and preserves selected synthetic evidence; production backend retention remains separate.

### Compatibility and query projections

Use strict version dispatch and explicit down-projection instead of trusting old readers to ignore new fields. Shared fixtures include supported profiles 1.0 and 1.1, plus unknown minor/major and forbidden-field cases. Profile 1.1 adds optional bounded integer `bunny.queue.depth`; its 1.0 projection removes that field and changes only schema identity, retaining queue wait time and every other common semantic field. The initial 1.0 compatibility profile is a defined fixture target, not a claim that an older product deployment already exists. The package releases as 1.0.0 with both profiles and defaults to profile 1.1. No current controller/lifecycle artifact is rewritten.

OTLP maps canonical fields to resource/scope/log fields and `bunny.*` attributes; schema identity survives conversion. Loki stream labels are only bounded service namespace/name and environment; instance, ticket, trace, operation identity and other high-cardinality values remain queryable metadata. Canonical local records have one host-owned conversion/export path to OTLP logs; SDK spans have one OTLP trace path. Do not also scrape local NDJSON into the same backend. A pure synthetic query fixture checks identical language semantics without parsing body text; actual ingestion/viewer evidence belongs to #704.

### Inventory and future adoption

Record concrete producer seams in the contract documentation with status not yet adopted and repository owner, including Node/Python/browser, hooks/receivers, controllers, verification and maintenance helpers. Pure/no-op, external-tool output, static artifacts and retired automation receive explicit dispositions. Product and helper machine results remain separate from canonical diagnostics. Browser adoption uses authenticated bounded same-origin owner relays without visible UI changes. Detached workers need a bounded owned sink and explicit queue/process context; Python thread-local context alone does not span SQLite/process boundaries.

## Risks / Trade-offs

- Structural privacy errors → common negative fixtures, no raw serializers, independent privacy/context review.
- Hidden unbounded sink buffers → bounded queues at the package boundary plus pilot saturation/export/shutdown measurements; no promise beyond the qualified host adapter.
- Different JSON/number/date behavior → shared boundary fixtures, safe integer bounds, exact decimal nanoseconds and cross-language normalized comparisons.
- Strict old consumers → explicit tested projections and immutable consumer pins; no silent field passthrough.
- Local structured output could break ready/receipt parsers → keep protocol channels unchanged and qualify diagnostic channels separately during adoption.
- A schema could be mistaken for full coverage → inventory remains unadopted until consumer evidence exists; full parent acceptance stays in GitHub.

## Migration Plan

Land and review the contract first, publish its immutable private artifact after merged-main CI, and bind archive hashes to the source revision. No runtime switches occur. The pilot consumes that artifact; supported evidence is required before repository-owned adoption children. A bad candidate can be replaced before publication; a published version stays immutable and a correction gets a new version with renewed consumer checks. Rollback of source consumers means an explicit prior pin, never mutation of old release bytes or live state.

## Open Questions

The owner accepted #704's initial resource/performance thresholds with a review-on-growth/failure policy; their exact pre-run workload and measurement definitions belong to that pilot's design. Docker availability remains pending and does not change this contract's accepted bounds. Live Node/ESM SDK initialization, Collector/Loki/Tempo mappings and actual overhead are technical pilot questions. Repository-specific transport wiring will be refined after its result, preserving the accepted source-only and privacy boundaries.
