## Why

Conversation can read and control the first LIFX bulb today. The owner wants the same access to the installed devices and the custom controls those integrations already provide. [#1941](https://github.com/jimmie-potts/agent-device-hub/issues/1941)

## What Changes

- Let the owner name a configured device, inspect its observations and see which supported actions are enabled in Conversation.
- Extend the existing approval and tracked dispatch path to Wemo power and the other installed integrations. Preserve each integration's admission, queues, and device ownership.
- Let the owner create a light-show draft, edit its cues, preview it, save a version, and play or stop a saved show through the existing Nanoleaf catalog and Music lighting controls. Link [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) for AI-generated drafts.
- Use the existing saved-art presentation workflow and show the operation outcome for each selected display.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` adds installed device discovery, owner-approved device actions, saved-art presentation, and light-show authoring and playback in Conversation.

## Impact

The companions module owns the tool catalog and durable approvals. The core and device modules keep their tracked operations, state, and writers. New tools require explicit configuration. Existing Conversation records and the LIFX and Hub tools continue to work. Installed verification uses a qualified Mac batch after source acceptance.
