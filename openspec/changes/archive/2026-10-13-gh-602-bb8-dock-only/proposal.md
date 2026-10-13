## Why

The owner selected dock controls while the robot cannot maintain off-dock power. Deliver the useful stationary controls and hibernate floor driving under [#602](https://github.com/jimmie-potts/agent-device-hub/issues/602); retain unpassed movement acceptance in #606.

## What Changes

- **BREAKING behavior:** refuse new public forward-reference and step commands before durable admission/helper dispatch.
- Present connection/wake, LEDs, power evidence and disconnect; remove driving/aim buttons and retain independently tracked Stop gesture.
- Retain the guarded protocol Stop path for old responsibility and safety, unchanged reader formats and the dormant helper implementation.
- Update only affected browser/catalog tests and operating guide. Add three fixed dock gestures (look-left, look-right, shake-head), using zero-speed headings from an original-BB-8 source example. Require dock confirmation and fresh charging evidence; never accept arbitrary scripts or animation IDs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bb8-module`: dock-only page, guarded named gestures and refusal of hibernated floor movement.
- `bb8-windows-link`: finite zero-speed gesture sequences, fresh charging check and existing local Stop/ownership rules.

## Impact

Existing BB-8 module/frontend and their source checks; one additive named-gesture request/operation, unchanged durable tables; no dependency, service, generic macro runner or shared upgrade profile. Existing source/review/CI and minimum software-install gates apply; floor movement is excluded; visible docked gestures require separate approval and acceptance.
