# Synthetic browser measurement

`synthetic-browser.json` records a disposable hub, fake Nanoleaf/Pixoo controllers
and a synthetic sensor view. Event-to-rendered-snapshot samples include the hub's
one-second notification cadence and browser scheduling. The ingest pair samples
measure a different boundary. Neither small sample qualifies Hub #30 budgets,
installed-client performance or physical output.

Reproduce with `npm run build` and `npm run test:dashboard:browser` on Node 24.
The command emits its receipt and desktop/mobile screenshots outside Git under
`DASHBOARD_RECEIPTS`, default `/tmp/gh6-dashboard-receipts`.
