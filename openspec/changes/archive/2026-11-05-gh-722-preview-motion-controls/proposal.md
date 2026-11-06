## Why

The generated Music effect preview can load and save complete reactive recipes, but the owner cannot edit their existing motion values. This completes a bounded part of [#722](https://github.com/jimmie-potts/agent-device-hub/issues/722) preset controls and [#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) effect tuning without admitting a light session.

## What Changes

- Add local draft controls for bass-pulse half-life, spectrum/wave direction and traveling-wave cycle duration using existing V1 bounds.
- Preview the complete edited recipe through the existing generated-input read and save it only through explicit Save new preset.
- Keep sensitivity and renderer smoothing read-only, preserving loaded values and all frozen V1 interpretation.
- Cover local edits, variant switching, stale preview fencing and immutable save/load behavior with source and browser evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-module`: extend reactive draft editing to existing effect-specific motion values while preserving the synthetic-only preview and preset boundaries.

## Impact

Nanoleaf frontend draft state and controls, existing model/browser tests and owning documentation. The existing full-recipe preview read and preset-save command remain unchanged under ADR 0012. No contract, schema, storage, dependency, source-input, worker, device or permission change is needed. V2 microphone response remains separate. Installation and physical acceptance remain with #725.
