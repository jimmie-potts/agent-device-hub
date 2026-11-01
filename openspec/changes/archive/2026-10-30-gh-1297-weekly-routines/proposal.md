## Why

The runtime's weekly power schedules run one on/off window per definition. [Hub #1297](https://github.com/jimmie-potts/agent-device-hub/issues/1297) wants a routine that runs an ordered list of typed device commands at a chosen local time on chosen weekdays, with a content action such as a Pixoo playlist start running only while the device is in a content mode, so a scheduled playlist never displaces agent status (epic #45).

## What Changes

- Generalize the `rules.kind = routine` definition from one on/off power window to weekly `{days, time}` plus an ordered action list; each action names a configured target, one tracked command family the target's module declares and that family's payload, with a required mode on content actions (default Media for a Pixoo, Free for a Nanoleaf).
- Reuse the power-schedule timer, future-only selection, definition identity and occurrence watermark; fire each action in order through the tracked dispatcher with fresh request identity and configuration/generation guards; skip a content action whose device is not in the required mode and log it; pass `requireMode` to the Pixoo for its admission check (#1276); drop an overlapping occurrence as `busy`; let a refused, failed or uncertain action continue to the next.
- Add an explicit Run now that submits one occurrence immediately.
- Migrate each retained `power-window/1.0` row once into an on routine and an off routine.
- Move the routes to `/api/v2/automation/routines` and extend the Automation page's schedule editor to an action list with per-action preconditions and Run now.
- Add the `routine-actions` catalog scenario beside the renamed `weekly-routines` scenario.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-power-schedules`: routines with an ordered action list, content-mode preconditions, one occurrence in flight, Run now and the one forward migration of power windows.

## Impact

`apps/runtime/src/core/power-schedules.ts`, `automation-store.ts`, `automation-part.ts`, `core.ts`, `gateway/automation-routes.ts`, the dashboard Automation page, the runtime unit and gateway tests, the scenario catalog, the runtime README, development, upgrade and verify guides, and this capability. The shared device families and the Pixoo module are unchanged beyond #1276. No MCP tools, timezone features or missed-run history. Source delivery activates no installed routine; the installed upgrade and the live Pixoo check follow under the standing installation authority.
