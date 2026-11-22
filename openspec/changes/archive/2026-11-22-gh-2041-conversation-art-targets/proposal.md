## Why

Conversation can offer a display command using a rendition kind as its destination. The same kind can name several configured displays, each with a different routing ID. A generated attachment already identifies the exact generation job, so the owner can choose where to show that result without another model turn.

## What Changes

Resolve named displays against the core's configured target inventory. Match the exact artwork's usable compositions. Preserve requested destinations with generation and provide an explicit display approval beside the completed attachment. Validate the chosen display again before sending. Report preparation and presentation outcomes for each surface.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` gains exact art display selection and attachment approval.
- `bunny-message-profile` gains guarded art shows and a configured art target snapshot.
- `bunny-runtime` exposes the approval view of configured destinations.
- `bunny-art` identifies usable compositions on the private attachment read.

## Impact

[Issue #2041](https://github.com/jimmie-potts/agent-device-hub/issues/2041) covers Companions, the Art page's existing target rules, the core's show owner and its SDK contracts. Generation and display have separate approval and tracked effects.
