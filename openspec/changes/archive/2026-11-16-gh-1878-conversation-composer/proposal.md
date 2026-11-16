## Why

The Conversation composer puts a technical counter inside a nested input surface and leaves Voice in the header. [Hub #1878](https://github.com/jimmie-potts/agent-device-hub/issues/1878) puts the next action beside the draft and keeps detailed guidance available on demand.

## What changes

- Use one compact input surface with contextual Send or Answer, keyboard guidance and a short disclosure about submitted text. Show the UTF-8 count near the input limit.
- Put Voice and active Stop beside the input action. Give the panel a title and close action. Keep playback details expandable and current blockers and recovery readable beside the controls.
- Put the full draft and submitted-text explanation in Conversation settings.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks`: Conversation composer and spoken reply presentation.

## Impact

The companions frontend, guide and existing synthetic browser journeys change. The existing assistant input and speech session remain the entry points.
