## Why

[Hub #925](https://github.com/jimmie-potts/agent-device-hub/issues/925) moves event automation into the B.U.N.N.Y. core and adds bounded Nanoleaf Lines moments. The runtime currently refuses moments and has no rule owner. The owner selected fresh rules and settings, with no transfer from the legacy Hub.

## What Changes

- Reuse the Hub rule engine, arbitration, interrupt set, budgets, quiet hours and private table format in the core. Evaluate only new live core occurrences; restart, sync and outbox republication never launch a moment.
- Dispatch moments through the core tracker with the runtime clock. Show acceptance separately from completion, failure and uncertainty.
- Reuse Nanoleaf's effects and single device writer for bounded Lines moments. Restore current Work rendering or a known named Free scene; refuse unknown Free content before effect writes.
- Expose one Automation page through the authenticated gateway, preserving the existing rule and settings shapes. The coordinating writer owns those frontend and gateway changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: core event automation and its authenticated controls.
- `nanoleaf-module`: bounded Lines moment admission, execution and restoration.

## Impact

Changes core automation and Nanoleaf modules, focused tests, owning guides, gateway and dashboard integration. No migration, scheduler, framework, model calls, rule kinds, physical-device tests or installed-service changes. Legacy Hub automation continues unchanged until its selected cutover.
