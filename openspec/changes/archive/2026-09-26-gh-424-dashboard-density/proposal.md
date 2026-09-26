## Why

The owner reviewed the dashboard candidate for [Hub #424](https://github.com/jimmie-potts/agent-device-hub/issues/424) and requested less text, less unused space, compact indicators and supporting information on hover. On 2026-09-26 the owner authorized the proposed layout and accessible details treatment in chat.

## What Changes

- Place compact device controls beside sessions that start at the top of the page.
- Replace the Collector card with a feed indicator; keep diagnostics available on hover/focus and Connections.
- Keep session names, project/provider and activity visible; put secondary evidence and label editing behind Details.
- Preserve visible attention, uncertainty and command outcomes. Collapse empty attention to one line.
- Support hover, keyboard focus, Escape and touch without adding device writes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: compact home layout and accessible optional details.

## Impact

Dashboard presentation, responsive CSS, existing shared control cards and browser fixtures. The approved lifecycle 1.1/snapshot 1.2 contract, state owner and device writers do not change. Final UI approval remains required before merge; installation remains outside this source delivery.
