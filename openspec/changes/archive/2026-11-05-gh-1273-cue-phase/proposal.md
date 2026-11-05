## Why

[#1273](https://github.com/jimmie-potts/agent-device-hub/issues/1273) already selects the current cue and its elapsed time, but rendering always starts the ordinary animation. Internal canonical frame preparation and transition location make that elapsed time useful without inventing a physical seek guarantee.

## What Changes

- Prepare immutable canonical frames for a cue against an explicitly supplied layout.
- Locate each zone's current transition using actual frame durations, preserving unknown initial origins, loops and one-shot completion.
- Add the pure frame helper to the existing package `effects` namespace, with no new export-map path or remote contract.
- Preserve existing timeline formats and ordinary animation payload bytes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-music-timeline`: internal bounded frame preparation and deterministic transition location.

## Impact

Only Nanoleaf internal helpers, tests and owning documentation change. No external or cross-repository contract changes. This work crosses no component boundary and adds no SDK family, route, timer, persistence, device call or diagnostic record. Public preparation remains with #760/#1238. Worker admission and #40 policy, recording association, speaker calibration and installed/physical acceptance remain separately owned.
