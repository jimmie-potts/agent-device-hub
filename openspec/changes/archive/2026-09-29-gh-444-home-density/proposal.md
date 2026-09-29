## Why

[Hub #444](https://github.com/jimmie-potts/agent-device-hub/issues/444) installed the dense dashboard from #277, but the owner found that the Beam widget is partly below the first desktop screen and Pendant 1 is below it. The existing home check accepts a widget whose top edge is visible even when most of the widget is off screen.

## What Changes

- Arrange the registered component widgets in rows within the device side of Home so all six installed components fit fully in the first screen at the tested desktop viewport. Keep Sessions alongside them and retain the one-column layout at phone width.
- Strengthen the browser check to require the full bounds of six component widgets inside the desktop viewport, with a negative control against the prior layout. Check the candidate visually at desktop and 390 px.
- Update the dashboard verification description and the home scenario to distinguish fully visible widgets from widgets that merely start in view.

The schema's design document is conditional. This change stays in one dashboard
stylesheet and its existing browser check, with no new dependency, data model,
security boundary, migration or unresolved implementation choice, so no
`design.md` is needed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: clarify the home first-screen scenario for six registered components and full widget visibility at the verified desktop viewport.

## Impact

The change is limited to dashboard layout, its browser check, the unified-dashboard specification and dashboard verification documentation. It changes no Hub API, device/controller contract, credential, command, state owner or installation. The current UI candidate requires owner approval before merge. Installation, restart and any device-changing check remain separate owner checkpoints.
