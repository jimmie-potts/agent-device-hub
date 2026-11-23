## Why

The Conversation composer currently uses separate artwork save and display controls. The owner wants Send to post an attachment to the chat, save it to the library and carry out an explicit playback instruction for a named display. [Hub #2072](https://github.com/jimmie-potts/agent-device-hub/issues/2072)

## What Changes

- Accept an attachment-only Send and store the exact attachment on the sent message.
- Save each sent attachment once. Ask whether to display an attachment sent without instructions.
- Treat a direct instruction naming one configured display as authorization to show the attached artwork once. Ask for the destination when the request is ambiguous.
- Keep save and display outcomes in the original exchange. Carry #1986's physical validation forward to this delivery.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` covers sending the owner attachment, clarifying the display and applying the bounded authorization.
- `bunny-art` covers durable promotion as part of Send and independent display outcomes.
- `bunny-message-profile` covers tracked Send and evidence correlation while preserving released clients.

## Impact

The composer, Companions message and turn storage, the Art save path and the existing guarded display command are affected. The change uses the existing SDK and one display writer per device. The shared confirmation interface belongs to [#1989](https://github.com/jimmie-potts/agent-device-hub/issues/1989#issuecomment-7115777266).
