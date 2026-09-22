## Why

[Hub #6](https://github.com/jimmie-potts/agent-device-hub/issues/6) needs one BUNNY interface for Codex activity and supported integration controls. Hub #5, Nanoleaf #49 and Pixoo #33 now deliver its required APIs.

## What Changes

- Add a React/TypeScript dashboard with activity, component and connection views, based on the delivered Nanoleaf interface.
- Preserve separate activity, attention, notice acknowledgment, read evidence and observation freshness.
- Provide controller-declared integration settings and modes with explicit submission, revision guards and visible uncertain outcomes.
- Serve the built frontend from the hub origin, with scoped browser access and validated links to advanced editors. Keep native controller credentials server-side.
- Add a reusable component-view pattern and synthetic browser qualification including a third component, reconnect, concurrent edits and accessibility.

## Capabilities

### New Capabilities
- `unified-dashboard`: Protected central integration UI, reusable component views and resilient observation/control behavior.

### Modified Capabilities

None. Released controller wire contracts remain unchanged.

## Impact

Adds apps/dashboard, hub frontend serving/context, build/browser checks and documentation. Uses the delivered controller v1 contract and the extensions owned by [Nanoleaf #49](https://github.com/jimmie-potts/codex-nanoleaf/issues/49) and [Pixoo #33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33). No installed services, hooks, state migration, physical operations, general device controls, full editor port or exact previews. The current UI candidate requires explicit human approval before merge.
