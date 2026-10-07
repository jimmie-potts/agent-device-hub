## Why

The Tidbyt module ([Hub #930](https://github.com/jimmie-potts/agent-device-hub/issues/930)) timed each tile's 15-second gate from the moment a request went out, while the cloud receives a push some time later. When the first of two pushes took longer to reach the cloud than the second, the cloud saw them less than 15 s apart: PR #969's App verification run saw 14,847 ms in `tidbyt-tiles`, and an Acceptance reviewer saw 14,999 ms. The real Tidbyt cloud would see the same.

## What Changes

- Each tile's gate runs from the end of its previous call: the answer, a failure such as a refused connection, or the call's 10-second deadline when nothing came back. A request reaches the cloud before its call ends, so within one start of the module, while the wall clock does not step forward, the cloud receives a tile's writes at least 15 s apart.
- The refresh of an unchanged frame runs 10 minutes from the end of that frame's push.
- Unchanged: the stored gate time, the wall-clock rule that a stored time in the future counts as now, and the uncertain store before a write goes out. A write the module stops or crashes during keeps the time its request went out, so the next start's first push can reach the cloud less than 15 s after it, by that request's travel time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-tidbyt`: "One writer, the 15-second gate and no replay" measures the gate from the end of the previous call, with scenarios for a push that reaches the cloud late and one that never answers.

## Impact

- **Code:** `modules/tidbyt/src/writer.ts` (`TileWriter`); the module tests and their host, which can delay a push on its way to the simulated cloud.
- **Docs:** `modules/tidbyt/README.md`.
- **Unchanged:** the module's configuration, records, messages, stored columns and every other module. No coordinator-owned file changes.
- **Delivery:** source-only until the cutover (#840) installs the runtime.
