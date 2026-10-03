## Context

The #704 pilot already has canonical Pino/OTLP pipelines, bounded queues and cancellable numeric-loopback transports. Hub command diagnostics accepts a host emitter and tracer but normal CLI configuration does not supply them. Python contract helpers already provide bounded emission and explicit context capture.

## Goals / Non-Goals

Provide host-owned runtime construction and the practical #730 Hub coverage. No general instrumentation framework, new collector service, environment auto-discovery, automatic HTTP hooks, domain-state migration or live installation. The existing pilot remains reproducible against its original immutable contract archive.

## Decisions

- Ship runtime helpers in artifact 1.1.0 with unchanged schema profiles. Keep pure/browser imports separate. Consumers explicitly import the host module, avoiding SDK setup during library imports. Preserve the reviewed immutable 1.0.0 archive.
- Reuse the tested Node projection/queue/transport algorithms. A Node tracing host owns its provider/context lifecycle; tracing uses manual spans only, so no ESM hook or vendor/device propagation is needed. Host configuration selects the numeric loopback Collector origin and optional sampling ratio (default 0.1), not ambient OTel exporter settings.
- Python uses the OTel SDK for spans and the same canonical projection/OTLP fields, with explicit context across owned threads. It owns bounded per-signal asynchronous queues and bounded HTTP sends. A persisted process handoff without context remains a new trace plus the ticket; changing domain persistence is unnecessary.
- Local canonical INFO-and-above logs are the enabled host default. Export and tracing require explicit configuration. Node uses a separate diagnostic channel with bounded writes; detached Python consumers supply their owned sink. No dynamic messages, captured exceptions or bodies are introduced.
- Hub adds an optional private `observability` configuration and constructs its runtime in the CLI. Existing injected command diagnostics remains supported. Request metadata comes from registered operations only; authentication precedes incoming trace adoption. MCP tool and important owned background actions get explicit wrappers rather than automatic capture.
- Final #730 package/review/CI acceptance is the required boundary before downstream consumers. No extra intermediate artifact release or standalone framework issue.

## Risks / Trade-offs

- Global OTel context can conflict with another owner -> one explicit tracing runtime per host process, no import-time registration, bounded shutdown and tests for lifecycle failures.
- Telemetry failure could mask a command -> wrappers invoke the domain action exactly once, preserve its return/error and count safe diagnostic failures.
- A slow stream/backend can fill output -> existing queue/record limits and cancellable sends; concurrent signal flush limited to one second. No spool/retry.
- Sampling omits spans -> record flags truthfully; logs remain queryable by operation/ticket. Use ratio 1 only in synthetic correlation tests.
- Python packaging adds optional SDK dependencies -> pin host requirements in the artifact and run external consumer checks; pure helpers retain their existing import behavior.

## Migration Plan

Source-only additive opt-in change. Existing configurations and immutable consumers remain supported. Disabling diagnostics returns to the existing host output. Consumer PRs pin the newly accepted artifact. Installation remains separately authorized.
