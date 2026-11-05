## Why

Prepared shows need deterministic cue selection before they can safely join the existing Nanoleaf writer. This bounded source increment of [#1273](https://github.com/jimmie-potts/agent-device-hub/issues/1273) makes recipe resolution and transport-position behavior testable while music admission remains separately owned.

## What Changes

- Validate and freeze version-one semantic timelines using existing animation recipes.
- Select the current cue directly on an explicit local clock, with pause, resume, seek, stop, missed-cue reporting and generation fencing.
- Render selected recipe values through the existing Lines/NL22 encoder in synthetic checks, without scheduling writes or claiming phase-accurate playback.

## Capabilities

### New Capabilities

- `nanoleaf-music-timeline`: bounded internal timeline preparation and deterministic semantic cursor behavior.

### Modified Capabilities

None. Existing device commands, favorites, workers and live capture retain their contracts.

## Impact

Only Nanoleaf internal helpers, tests and their documentation change. This increment crosses no component boundary and adds no SDK family, persistent state, capture, timer, diagnostic record or device access. The full issue retains music admission/interruption under #40 and #1272, worker scheduling and outcome integration, show authoring under #723, qualified position under #571/#41, and installed/physical acceptance under #725. Exact preview preparation stays with #760/#1238.
