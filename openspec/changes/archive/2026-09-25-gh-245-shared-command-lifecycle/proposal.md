## Why

[Hub #245](https://github.com/jimmie-potts/agent-device-hub/issues/245): B.U.N.N.Y.'s one-click actions (`useCommand`) and draft forms (`EditForm`) each kept their own copy of submission, receipt tracking, busy and lock state, and refresh ordering. Both changed in [PR #239](https://github.com/jimmie-potts/agent-device-hub/pull/239). A fix to either copy had to be repeated in the other, and a lifecycle mistake could allow a duplicate or incorrectly guarded device command.

## What Changes

- Move the shared lifecycle into one dashboard-local module. It covers sending, blocked and failed preparation, results, the accepted-ticket watch, uncertain and partial locks, explicit reload and dismissal. One React hook drives it for both consumers. `useCommand` and `EditForm` keep their existing interfaces and delegate to it.
- Forms keep draft values and configuration-revision conflicts. Actions and forms keep building their own device requests and applying their own availability rules.
- Close gaps that the two copies left open:
  - A rejected or throwing preparation now reports that nothing was sent and frees the control. Previously it left "Sending…" shown.
  - A rejected refresh after a result keeps that result and resends nothing.
  - A second activation that arrives before the control re-renders as busy sends nothing.
- A form with an uncertain or partial result now stays busy until the refreshed view returns, as actions already did. It still locks until "Reload current values".
- Existing wording and layout are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: forms and one-click actions share one command lifecycle, including preparation failure, refresh failure and single activation.

## Impact

`apps/dashboard/src/lifecycle.ts` (new) and `apps/dashboard/src/main.tsx`, a new lifecycle unit test, one matrix scenario, the dashboard README and `docs/development.md`. There are no hub route, controller contract, fixture or skin changes. Visual restyling stays with [Hub #182](https://github.com/jimmie-potts/agent-device-hub/issues/182). This is source-only: no installation or device operation.
