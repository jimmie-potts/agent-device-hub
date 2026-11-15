## Why

[#1858](https://github.com/jimmie-potts/agent-device-hub/issues/1858) makes saved dialogue and the composer the primary content of Conversation.

## What Changes

Use the recent-history reader on the existing page, with scroll preservation and explicit paging. Put task decisions beside the composer, with provider and task inspection under Details. Keep the existing spoken-reply controls mounted.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks`: Conversation layout, saved history navigation and draft behavior.

## Impact

Companions frontend and disposable browser journeys. The existing route, assistant and speech contracts, private storage, and tracked command boundary continue to apply.
