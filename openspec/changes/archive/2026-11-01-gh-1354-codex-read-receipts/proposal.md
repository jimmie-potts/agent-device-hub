## Why

[Issue #1354](https://github.com/jimmie-potts/agent-device-hub/issues/1354) has accepted Claude delivery and a successful manual Codex Desktop read experiment. The installed runtime still rejects Codex receipts. The demonstrated Desktop request/response observation needs a qualified producer and admission path before it can update the matching B.U.N.N.Y. session.

## What Changes

- Add a passive observer for the qualified Desktop/app-server versions. It forwards the native protocol, retains only selected identity/turn/revision metadata, and never issues a provider read update.
- Bind an accepted native action to the existing `codex/local` lifecycle identity, current owner generation, known completed turn and finished notice. Use the existing lifecycle/2.1 provider-client receipt and session/2.1 output.
- Enroll a distinct source-bound read/ingest credential and admit only this qualified Codex producer. Preserve Claude admission and all existing consumers.
- Provide an explicit, version-checked host launcher without changing personal hook configuration. Missing qualification, observation loss or unavailable B.U.N.N.Y. state suppresses collection while native work continues.
- Validate the complete path in a disposable runtime, then install through the established Mac container procedure and perform operator-run Desktop acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-agent-hooks`: qualified Codex Desktop protocol observation and explicit enrollment alongside the existing lifecycle producer.
- `bunny-runtime`: trusted admission and serialized application of provider-client receipts against the exact owner target.

## Impact

The change affects `apps/runtime` receipt helpers, native launch tooling, gateway admission, core receipt checks, tests and owning guides. It reuses the existing event contracts, SDK sync/stream and transaction/outbox; no contract schema change, new broker, Hub polling, state owner or storage table is selected. Existing Claude receipt behavior, PC Desktop metadata, source identities and device behavior remain unchanged. Private native evidence and installed artifacts stay outside Git. The earlier Claude OpenSpec archive remains historical; this change owns the remaining Codex delivery under the same issue.
