## Why

[Hub #2110](https://github.com/jimmie-potts/agent-device-hub/issues/2110) replaces
the three-slot worker policy with independent jobs in the established runtime.

## What changes

- Add explicit uncapped worker admission and per-attempt setup observations.
- Page jobs by stable identity independently of admission and preserve named stop.
- Preserve finite endpoints and carry the asking companion on every new start.

## Capabilities

### Modified capabilities

- `bunny-coding-delegation` supports an uncapped endpoint with bounded views.

## Impact

The worker, event contracts, Companions coordinator and Conversation page
change. The connection-bound worker grant and #2109 attempt lifecycle remain
the authority boundary.
