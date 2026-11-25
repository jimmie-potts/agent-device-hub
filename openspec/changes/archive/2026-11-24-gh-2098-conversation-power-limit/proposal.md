## Why

Conversation can report a Wemo plug's observed power but cannot answer whether
its maximum-on limit is running. The core already owns the current limit and
deadline. [Issue #2098](https://github.com/jimmie-potts/agent-device-hub/issues/2098)
covers both existing device reads.

## What changes

- Join a named Wemo plug to its current core power-limit record in
  `read_wemo` and `read_devices`.
- Report the recorded status, configured duration and last attempt. For a
  running limit, show the known start, deadline and time remaining at the read.
- Show local time alongside the ISO instant. Treat a lost copy as unknown
  until SDK sync completes again.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks` gains the maximum-on read behavior in Conversation.

## Impact

Companions consumes the existing `power-limit/2.0` family. The existing
read tool definitions and Conversation tests cover the change.
