## Why

[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)'s "Observability" ends with "Following one request": a disposable run can show the records and spans of one request or trace, and a missing record is reported as missing, never as proof that nothing happened. [Hub #949](https://github.com/jimmie-potts/agent-device-hub/issues/949) made the runtime record each decision once and record timed spans, and left the spans in the runtime's memory (`runtime.spans()`), where no process outside it can read them and a crash loses them. [Hub #950](https://github.com/jimmie-potts/agent-device-hub/issues/950) is the operator proof: Acceptance reviewers and developers follow one command end to end in a disposable run before device modules adopt the runtime, with no new viewer and no wait for Grafana ([#813](https://github.com/jimmie-potts/agent-device-hub/issues/813)).

## What Changes

- **A span destination for a run.** `--record-spans` (and `RuntimeOptions.spans: 'state-file'`) writes each finished span to a pair of owner-only files in the state directory, `spans.ndjson` and `spans.previous.ndjson`: the latest spans within the contract's 4 MiB queue bound, up to 1,024 and at least 512 unless spans are large, in two segments of at most 512 spans or 2 MiB, each starting with a header line that counts the spans let go, or says the count is unknown. A runtime that restarts continues the files; a kill keeps what was written. Without the flag nothing changes: the installed runtime keeps its spans in memory.
- **The follow query.** The run's supervisor answers `GET follow?request=<id>` or `?trace=<id>` on its loopback harness API, with limits. It validates every journal record and span against the diagnostic contract and builds the answer from the validated values alone, so no payload, message or error text reaches it. It reports what it matched, returned and left out, the bus's decisions and whether each admitted command has an ending, each span's parent, and each gap: a runtime that ended without `runtime.stopped`, telemetry reported lost, spans evicted, a read cut at its bound, records and spans the contract refused, spans with missing parents and its own caps. An absent request answers `none-found` and never claims that nothing happened.
- **The proof.** A capture step `follow-one-request` on the fixture modules follows a success, a refusal, an uncertain effect and a replayed outcome, then a killed runtime, an absent request and a capped query, attaches each answer and judges it; `control-follow-fails` is its negative control. `stop` removes the run's span file with its runtime directory.
- **A journal that reads true.** The supervisor passes `--log-level info` explicitly and waits for a stopped runtime's stderr to drain before the next starts, so a clean stop's `runtime.stopped` record is in the journal and only a killed runtime shows as ended without one.
- **Docs.** The runtime and adapter READMEs, the diagnostic contract's adoption section and `docs/development.md`'s runtime verification checks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: a requirement for following one request in a disposable run; the run's runtime arguments, harness and capture steps; and the span file as a destination for recorded spans.

## Impact

- **Code:** `apps/runtime/src` (new `span-file.ts`; `runtime.ts`, `process.ts`, `index.ts`) and `apps/runtime/verify` (new `follow.ts`, `follow-proof.ts`; `supervisor.ts`, `plugin.ts`), with tests beside each.
- **Unchanged:** the installed runtime's behavior and arguments, the runtime's health and edge, the diagnostic contract's profile and catalog (no new record or span name), `packages/app-verify`, the host route's operations, and everything a run must never touch: installed services, personal state and devices.
- **Delivery:** source-only. Nothing installs the runtime yet.
