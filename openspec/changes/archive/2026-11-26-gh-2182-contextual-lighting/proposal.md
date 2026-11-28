## Why

[Issue #2182](https://github.com/jimmie-potts/agent-device-hub/issues/2182) extends contextual Conversation controls to registered lighting capabilities. The current phrase checks block ordinary follow-ups and can hide the selected device's current settings.

## What Changes

- Resolve power, brightness, color and temperature through the shared model-control validation used by [#2181](https://github.com/jimmie-potts/agent-device-hub/issues/2181).
- Let the selected supervisor interpret desired, starting, relative and extreme values. Validate complete numeric quantities and use fresh observed state when the setting depends on it.
- Let the selected supervisor classify the complete current lighting request and report the operation, execution scope, and any missing setting. Bind device reads and commands to the same current permissions. A missing read selector gets one repair.
- Preserve guarded dispatch, tracking and Pixoo brightness confirmation through the existing writers.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` covers contextual lighting controls and reads.

## Impact

Both Conversation supervisors use the Companions control path. Existing device commands and registration contracts continue to route effects.
