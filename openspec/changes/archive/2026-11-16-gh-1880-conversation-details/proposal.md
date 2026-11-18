## Why

Details takes a row beneath the composer at narrow widths and appears as an
accordion on desktop. [Hub #1880](https://github.com/jimmie-potts/agent-device-hub/issues/1880)
keeps inspection available in a drawer with a visible close action.

## What changes

- Open an independently scrolling Details panel beside the conversation on wide
  screens and over it on narrow screens.
- Keep the selected profile, four existing groups, draft and reading position.
- Coordinate Details and Voice visibility and keep Stop speaking in reach.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks`: Conversation Details presentation and dismissal.

## Impact

The companions frontend and its existing browser journeys change. The dashboard
uses the same saved facts, commands, history and speech endpoint.
