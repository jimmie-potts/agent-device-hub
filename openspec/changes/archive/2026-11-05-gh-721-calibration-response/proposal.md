## Why

The selected microphone can report raw levels, but the operator cannot measure a quiet baseline or see how a noise gate and response settings change those levels. This connected source increment for [#721](https://github.com/jimmie-potts/agent-device-hub/issues/721) adds explicit calibration and a numerical response preview without admitting lighting work.

## What Changes

- Add bounded core-owned quiet measurement, an explicit candidate Apply, and private persisted response settings and evidence.
- Add closed control/state 2.2 schemas while accepting unchanged 2.0 and 2.1 messages. Publish one current 2.2 state.
- Share one browser-safe Nanoleaf response calculation between the numerical preview and an explicit renderer V2; preserve renderer V1 interpretation.
- Keep raw input measurements separate from response preview. Expose source binding, retained but inactive thresholds, cancellation and truthful tracked outcomes.
- Preserve independent Stop, manual input selection and all physical/install boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-music-capture`: bounded calibration, persisted settings and per-generation qualification.
- `shared-event-contract`: additive calibration/tuning control and state 2.2.
- `bunny-runtime`: atomic command outcomes, persistence and interruption recovery.
- `runtime-dashboard`: explicit calibration/tuning controls and numerical response preview.
- `nanoleaf-module`: one shared response calculation and versioned frozen recipe interpretation.

## Impact

Implementation changes are confined to event contracts, runtime core/gateway/dashboard, Nanoleaf response math and their existing checks. The candidate builds on the merged microphone, preview and saved-preset interfaces. Producer and native implementations keep their raw measurements unchanged; their guides explain the core-owned calibration boundary. No device worker, permission prompt, installed state, automatic fallback or physical qualification is included. [#722](https://github.com/jimmie-potts/agent-device-hub/issues/722) and [#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) retain their remaining full scope. Existing private history preserves derived observations; no PCM or private microphone UID enters the core.
