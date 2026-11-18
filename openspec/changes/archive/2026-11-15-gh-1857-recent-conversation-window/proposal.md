## Why

Opening a long saved conversation starts at its oldest message. The owner should see the newest saved exchange without first reading the rest of the thread. [Issue #1857](https://github.com/jimmie-potts/agent-device-hub/issues/1857) defines this change.

## What changes

- Add an opt-in newest window and exclusive earlier cursor to the existing authorized conversation read.
- Retain the existing forward pagination for version 1 consumers.
- Give the dashboard a typed reader that retains loaded history while refreshing and isolates obsolete responses.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks`: private conversation history, recent windows, and independent current question.

## Impact

The companions owner and its browser contribution change. Runtime authorization, assistant state and task transitions, storage layout, and event contracts remain as they are.
