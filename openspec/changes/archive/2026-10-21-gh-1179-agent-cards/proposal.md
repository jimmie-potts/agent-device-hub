## Why

The approved agent-card design needs reusable runtime components rather than Home-local rendering. See https://github.com/jimmie-potts/agent-device-hub/issues/1179.

## What Changes

- Extract reusable card, summary and collection presentation over the existing session copy.
- Show concise faces, amber attention and expandable evidence; remove the duplicate Home attention box.
- Preserve filters, label editing, unread policy and freshness distinctions.

## Capabilities

### New Capabilities
- `agent-status-cards`: reusable concise dashboard cards over existing core sessions.

### Modified Capabilities

- `runtime-dashboard`: update Home placement and disclosure wording; existing session and command contracts remain unchanged.

## Impact

Runtime dashboard presentation, existing widget placement and synthetic browser checks. No new dependency, API, state owner or device behavior.
