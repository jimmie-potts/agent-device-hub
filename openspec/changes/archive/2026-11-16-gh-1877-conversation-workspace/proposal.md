## Why

Conversation's full module navigation and fixed-height transcript leave little room to read. On phones the composer opens below the viewport. [Hub #1877](https://github.com/jimmie-potts/agent-device-hub/issues/1877) gives the conversation the remaining height and clarifies which chat profiles are demos.

## What changes

- Put the Conversation title and a disclosure for the existing companion page links in one local header.
- Fit the transcript and composer to the available height, and allow document scrolling when the controls need more room.
- Identify B.U.N.N.Y. as the everyday assistant and label Reachy and MicroDuck as demos before selection.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks`: Conversation workspace and profile navigation.

## Impact

The runtime dashboard shell and the companions frontend change. Routes, state and command owners, message contracts, and providers stay the same.
