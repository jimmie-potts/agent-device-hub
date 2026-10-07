## Why

[ADR 0012](../../../../docs/decisions/0012-bunny-event-platform.md)'s "Observability" section, rewritten by the 2026-10-07 amendment ([#947](https://github.com/jimmie-potts/agent-device-hub/issues/947)), says that the boundary that makes a decision records it once, at a fixed level, and that spans with a start, end, status and parent or links are recorded through the observability package's host adapter. Today the SDK bus and edge record no command decisions, the outbox is silent when it defers a publish, the SDK's default error report quotes an exception's message, nothing records a timed span, and the host adapter cannot record spans without a Collector. [Hub #949](https://github.com/jimmie-potts/agent-device-hub/issues/949) adds the instrumentation; export and viewing stay with [#813](https://github.com/jimmie-potts/agent-device-hub/issues/813).

## What Changes

- **One SDK diagnostic callback.** `onDiagnostic`, optional and a no-op by default, on the bus, the remote edge and the remote client. It receives a closed, bounded record of each decision at the boundary that makes it: a command admitted, refused (no responder, a full queue, its expiry, a responder that closed), cancelled before it started, replied to by its owner, or left uncertain; a sync served, refused or restarted after an overflow; an edge part connected, disconnected, refused or failed, the last with the code the edge answered (`internal`, or `uncertain-result` after it handed a command to its bus); and a request that the remote client settles `uncertain-result` itself. The SDK sets each record's level by ADR 0012's rules. A record made before authentication carries only the route and the code. A call its caller drops while the edge reads it is a cancellation, not a failure. The edge's `log` option and `EdgeLogRecord` are replaced by it.
- **A span interface in the SDK.** `SpanRecorder.start(name, {parent, links, kind, attributes})` returns a span with its own trace context and `end(status)`. Without a recorder the SDK keeps today's contexts. With one, the bus records `bunny.command.request`, `bunny.command.queue` and `bunny.command.execute` for each command; a command carries its request span's context and a reply its execute span's.
- **Module tracing.** `ModuleContext.trace.start` records a module's own spans, such as `bunny.device.call` around device I/O; no trace context reaches the device.
- **Outbox records and spans.** With the module's `log` and `trace`, the outbox records an outcome's first publication once (`outcome.published`), a refused publish once per run of refusals as `outbox.deferred` with its code and the count of waiting messages, in place of #948's `onError` report, and a `bunny.outcome.publish` span for each outcome it sends. Work replayed after a restart, or deferred from an earlier transaction, links to its stored context and is never reparented.
- **Repeated device failures summarized.** `DeviceAvailability` logs a polled device's first failure as one `device.unavailable` warning, counts later failures in debug summaries at most once a minute, and logs one `device.available` record with the count when it recovers.
- **A safe default error report.** Without an `onError`, the bus and the remote client report the error's type, never its message. The remote client's reconnect loop reports the lost stream and its recovery as records instead of each failed attempt as an error.
- **Profile 1.3 and artifact 1.3.0.** The catalog registers the runtime's decision events (`runtime.command.*`, `runtime.sync.*`, `runtime.edge.failed`, `runtime.tracing.failed`), the module events `outcome.published`, `outbox.deferred`, `device.unavailable` and `device.available`, the attributes `bunny.routing.key`, `bunny.outbox.waiting_count` and `bunny.attempt_count`, and the span names `bunny.outcome.publish` and `bunny.device.call`. Every pin moves to 1.3.0 together.
- **A bounded local span sink.** `createHostDiagnostics` takes `localSpanSink`, so tracing works without a Collector: the same `projectSpan` output through the same bounded queue and counts. `globalContext: false` records spans with explicit parents and installs no process context manager. `schemaVersion` names the profile of the host's records and spans.
- **The runtime connects both.** It writes SDK records under `bunny.runtime`, records the bus's and its modules' spans through the host adapter with tracing on and no exporter, keeps the latest spans in a bounded buffer or passes them to a given sink, counts lost spans in `runtime.stopped`, and writes profile 1.3 records. A request ID that the 1.x attribute pattern refuses is left out rather than lose the record.
- **Kit checks.** The module test kit checks the bus's records and spans for the accepted and refused commands, with the command's trace and correct parenting, and that an outcome's publication is recorded once and its replay links to the stored context.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: decision records, the span interface, outbox records and spans, device availability, the safe default error report, the edge's and the client's diagnostics, where the outbox reports a deferral, and the kit's record and span checks.
- `bunny-runtime`: the runtime's decision records, recorded spans, module spans and profile 1.3 records.
- `shared-observability-contract`: profile 1.3 and artifact 1.3.0.
- `shared-observability-host`: the bounded local span sink, explicit span parents without a process context manager, and a profile per tracer binding.

## Impact

- **Code:** `packages/sdk` (new `diagnostics.ts`, `spans.ts`, `availability.ts`, `testing/spans.ts`; `in-process.ts`, `in-process-sync.ts`, `remote-edge.ts`, `remote-client.ts`, `outbox.ts`, `module.ts`, `testing/*`), `apps/runtime` (new `src/diagnostics.ts`, `src/tracing.ts`; `host.ts`, `record.ts`, `runtime.ts`, the fixture lamp, the scenario harness and catalog), `packages/observability` (catalog, schema, fixtures, `runtime/host.mjs`, `runtime/span-pipeline.mjs`, Python version constants). `apps/runtime/verify/plugin.ts` adds the host adapter's sources to `build-current` and its files to the served candidate, since a run now loads them.
- **Pins:** `@jimmie-potts/bunny-observability` 1.3.0 in the Hub, maintenance, runtime, SDK and Pixoo media manifests, the lockfile and the Hub, maintenance and observability packaging scripts; `@opentelemetry/api` 1.9.1 joins the runtime's dependencies.
- **Docs:** the diagnostic contract, the observability, SDK and runtime READMEs and `docs/development.md`'s observability checks.
- **Unchanged:** the default producer profile 1.1, released 1.x controller contracts, the edge's authentication and validation order, the messages and their trace IDs, OTLP export, which stays with #813, `packages/app-verify`, and the verification run's behavior.
- **Delivery:** source-only. Nothing installs the runtime yet.
