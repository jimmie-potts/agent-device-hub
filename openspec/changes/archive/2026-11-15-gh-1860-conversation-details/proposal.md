## Why

The Conversation page has one block of routine details, and full tool text competes with saved replies. [Hub #1860](https://github.com/jimmie-potts/agent-device-hub/issues/1860) gives each fact a labelled place and lets the owner expand saved tool text when needed.

## What changes

- Present Capabilities, Task activity, Usage and Conversation settings as collapsed sections in Details.
- Keep task decisions and unresolved or negative control outcomes beside the composer.
- Disclose the full saved tool text in its original transcript row.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks` specifies the Details sections, guarded settings and saved tool disclosures under Conversation panel.

## Impact

Companions React presentation, the Conversation guide and disposable dashboard journeys. The page uses the existing assistant state, saved history and tracked commands. Source delivery uses synthetic evidence.
