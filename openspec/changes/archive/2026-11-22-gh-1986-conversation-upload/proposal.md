## Why

[Issue #1986](https://github.com/jimmie-potts/agent-device-hub/issues/1986) lets the owner preview a local still or GIF in Conversation and choose where it goes.

## What Changes

- Add file drop, keyboard attachment, preview, replacement and removal to the Conversation composer.
- Offer display only, library only, and both. Each outcome stays visible independently.
- Reuse the private Conversation attachment renderer, Art storage and tracked Show command.

## Capabilities

### Modified Capabilities

- bunny-assistant-tasks for the attachment interaction.
- bunny-art for temporary uploads and explicit library commits.
- bunny-message-profile for the tracked upload and save commands.
- bunny-runtime for authenticated binary upload and display admission.

## Impact

The Conversation frontend, the runtime gateway and Show planning, the Art owner and the event contract change. Existing Art uploads keep their current behavior.
