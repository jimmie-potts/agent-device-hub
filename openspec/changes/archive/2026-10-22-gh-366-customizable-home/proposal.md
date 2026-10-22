## Why

[Hub #366](https://github.com/jimmie-potts/agent-device-hub/issues/366) lets the owner arrange the reusable cards already delivered. Home currently chooses their placement in code.

## What Changes

- Implement the approved Edit Home preview: catalog, add/remove/hide, supported sizes, drag and keyboard reorder, Cancel, Reset and Done.
- Save desktop and phone arrangements in the current runtime's private core store, following the existing metadata command/sync pattern.
- Reuse existing light/room, display, plug, music, session, Hub mode, Inbox and exposed Wispr cards.
- Keep actionable Inbox and session cards visible even when their ordinary placement is hidden. No separate notices section or layout label is added.

## Capabilities

### New Capabilities
- `home-layout`: Saved, revision-guarded owner arrangements and reusable card placement.

### Modified Capabilities
- `runtime-dashboard`: Home defaults become a responsive editable grid while retaining existing card behavior and Timeline access. Existing device controls and other pages retain their contracts.

## Impact

Current runtime core, shared profile 2.0 families and dashboard. No new dependency, service, device writer or polling. The owner selected live delivery in this conversation; installation follows the established runtime procedure after source gates.
