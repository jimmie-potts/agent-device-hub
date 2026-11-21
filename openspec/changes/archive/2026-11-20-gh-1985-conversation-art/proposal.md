## Why

Conversation can propose showing saved artwork. A companion also needs to return a new still image or GIF in its reply and keep it with the conversation. [#1985](https://github.com/jimmie-potts/agent-device-hub/issues/1985)

## What Changes

- An enabled Conversation tool proposes one still or GIF for the owner to approve.
- The art service creates and saves the requested format through its existing queue, limits and private catalog. Conversation renders the saved rendition inline.
- The reply keeps its reference across reopening and reports failed generation or unavailable media. Reduced motion keeps the first frame still until the owner plays it.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` adds approved artwork and private message attachments.

## Impact

The command crosses Conversation, core and Art. Existing text history, media authentication and device authorization continue to apply. Verify with a disposable browser, then use a qualified Mac rollout.
