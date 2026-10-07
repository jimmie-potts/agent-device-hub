## 1. Profile 1.3 and the local span sink

- [x] 1.1 Assert, red before the catalog change, that profile 1.3 registers the runtime's decision, outbox and device events, the three attributes and two span names, that profiles 1.0 to 1.2 reject them, and that the schema and catalog agree (`profile.test.mjs`, `test_profile.py`), with cross-language fixtures and their negative controls.
- [x] 1.2 Add profile 1.3 to the catalog, the schema and the Python and TypeScript version constants, and move the artifact and every pin to 1.3.0.
- [x] 1.3 Assert, red against the old adapter, that tracing with a local span sink and no Collector delivers projected spans with parents and status, that tracing with neither still fails, that a stalled or throwing local sink is bounded and counted, and that two `globalContext: false` hosts keep their own spans (`host.test.mjs`).
- [x] 1.4 Add `localSpanSink`, `globalContext` and `schemaVersion` to `createHostDiagnostics`.

## 2. SDK decision records and spans

- [x] 2.1 Assert, red against the old bus and edge, one record per command, sync and edge decision at its level with the work's trace, in process and remote (`diagnostics.test.ts`), including concurrent requests, a late reply, a throwing callback and a call before authentication.
- [x] 2.2 Add `onDiagnostic` to the bus, the edge (replacing `log`) and the remote client, with the levels and the edge's `edge.failed`.
- [x] 2.3 Assert, red before the span interface, the request, queue and execute spans, their parents, status and the contexts that commands and replies carry, and unchanged contexts without a recorder (`spans.test.ts`).
- [x] 2.4 Add `SpanRecorder`, the bus's spans and `ModuleContext.trace.start`.
- [x] 2.5 Assert, red against the old outbox, one `outcome.published` record on first publication and none on replay, one `outbox.deferred` warning with its code and waiting count, and publish spans parented or linked as required (`outbox.test.ts`).
- [x] 2.6 Add the outbox's `log` and `trace`.
- [x] 2.7 Assert, red before it exists, that `DeviceAvailability` logs one degradation and one recovery for a device that fails 200 polls, with debug summaries at most once a minute (`availability.test.ts`).
- [x] 2.8 Assert, red against the old default, that a default warning holds no part of an exception's message, and that the remote client reports a lost stream and its recovery as diagnostics, not as errors.
- [x] 2.9 Make the default error report safe and summarize the remote client's reconnects.

## 3. Kit checks

- [x] 3.1 Assert, red against the old kit, that the accept, refusal and outbox checks fail a module whose records or spans are missing, wrong or misparented (`kit.test.ts`).
- [x] 3.2 Record diagnostics and spans in the kit's world and harness, export `RecordedSpans`, and update the fixture lamp to record its outbox and device spans.

## 4. Runtime

- [x] 4.1 Assert, red against the old runtime, the runtime's command, sync and edge records as contract records, its spans in the sink and `runtime.spans()`, a failing span or log sink, a secret in exceptions, a request ID left out, and lost spans counted in `runtime.stopped` (`diagnostics.test.ts`, `tracing.test.ts`, `log.test.ts`).
- [x] 4.2 Connect the SDK's diagnostics and spans in the host and the runtime, write profile 1.3 and leave out request IDs the attribute refuses.
- [x] 4.3 Assert the records in the scenario catalog and the spans in the in-memory harness's end-to-end path, including a replayed outcome, a lost acknowledgment and the restarts (`catalog.ts`, `runner.test.ts`).

## 5. Documentation and qualification

- [x] 5.1 Update the diagnostic contract, the observability, SDK and runtime READMEs and the observability checks in `docs/development.md`.
- [x] 5.2 Run build, typecheck, lint, the observability Node, Python, query, package and browser checks, the SDK, event, runtime, scenario, verify, maintenance, Hub and Pixoo checks, the workflow checks and OpenSpec validation.
- [x] 5.3 Show that named tests fail under each negative control: a boundary that records twice, a record at the wrong level, a lost span parent, cross-talk between concurrent requests, a throwing sink that changes a result, `tok_SYNTHETIC123` in a record, a replayed outcome recorded again, a per-poll warning and tracing with no local span sink.
- [x] 5.4 Synchronize the affected specifications and archive the change.
