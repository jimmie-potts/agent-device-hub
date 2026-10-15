## Why

[Hub #483](https://github.com/jimmie-potts/agent-device-hub/issues/483) needs reusable weekly power schedules for two owner-selected lamp plugs. Scheduling belongs to the Hub rather than the Wemo transport. The current runtime Automation service and page support event-to-moment rules only. Existing [#359](https://github.com/jimmie-potts/agent-device-hub/issues/359) and [#360](https://github.com/jimmie-potts/agent-device-hub/issues/360) own the broader routine/editor direction; this change delivers only the bounded weekly-power slice.

## What Changes

- Add Hub-owned saved weekly power schedules with selected weekdays, local on/off times, one configured power-capable target and an explicit enable switch.
- Compose scheduling with existing core storage/lease, SDK device observations, tracked dispatcher, gateway authentication and Automation page. No direct transport writes, separate service or model call.
- Persist definitions and minimal occurrence guards. Edits/disable/delete invalidate pending callbacks; restart schedules future occurrences only. A past boundary is never replayed.
- Show the Hub-local clock basis, next occurrence and tracked outcomes separately from observed device power.
- Validate the shared path using synthetic generic devices; this change does not enable an installed schedule, contact a plug, implement a Wemo transport or claim #483 complete.

## Capabilities

### New Capabilities

- `bunny-power-schedules`: Hub-owned weekly scheduling for configured devices' declared power capability.

### Modified Capabilities

- `bunny-runtime`: extend the existing Automation controls with the bounded weekly-power editor while preserving event rules, scope checks and truthful outcomes.

## Impact

Source: apps/runtime core automation/store/dispatcher composition, authenticated automation routes, existing React Automation page, owning tests and guides. Use the existing SDK and event-contracts power-set family; no wire-family change, broker or third-party scheduling library. Stored schedule definitions are new private core-owned state and need explicit runtime format/admission/recovery coverage before installed activation.

Wemo onboarding, exact transport qualification and optional maximum-on enforcement remain pending under #483. Broader ordered routines, moments, presets, MCP scheduling tools, timezone selectors, exception calendars and additional real devices are outside this slice. One-time local onboarding helpers stay outside tracked source.
