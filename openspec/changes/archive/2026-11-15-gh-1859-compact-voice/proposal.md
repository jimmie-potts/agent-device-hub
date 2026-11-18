## Why

Conversation needs a compact way to turn speech on, stop playback and recover uncertain output while keeping the transcript and composer in view. [Issue #1859](https://github.com/jimmie-potts/agent-device-hub/issues/1859) defines the source scope.

## What Changes

- Add Voice to the Conversation header and show Stop speaking there during local playback.
- Give saved assistant messages a Read aloud action within the existing length limit.
- Keep the selected browser session at page scope so presentation changes cannot withdraw it.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` describes the Conversation voice interaction and saved message action.
- `bunny-companions` covers the browser endpoint lifetime across presentation changes.

## Impact

The companions browser frontend, synthetic browser journey and capability scenarios change. The existing frontend SDK controls and private speech and assistant event contracts continue to apply.
