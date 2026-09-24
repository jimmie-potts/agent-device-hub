# Synthetic browser measurement

`synthetic-browser.json` records a disposable hub, fake Nanoleaf/Pixoo controllers
and a synthetic sensor view. Event-to-rendered-snapshot samples include the hub's
one-second notification cadence and browser scheduling. The ingest pair samples
measure a different boundary. Neither small sample qualifies Hub #30 budgets,
installed-client performance or physical output.

`synthetic-matrix.json` records the extended state and accessibility scenarios,
including an 800 ms delayed Pixoo read with a separately timed Nanoleaf read.
This checks device isolation in a disposable fixture, not a production latency
budget. Keyboard activation and axe scans cover the component and connection
views as well as the main suite's desktop/mobile activity views. The Hub #151
scenarios record guarded general commands, Monitor gating with the explicit
switch, conflict and uncertain handling, and read-only or undeclared reasons
against the fake Pixoo's pinned capabilities; none is a physical result. The
Hub #153 scenarios record Nanoleaf power, brightness and scene commands, Work
gating with the explicit Free switch, and a controller-side scene rejection,
conflict and uncertain result against the fake Nanoleaf's declaration pinned to
Nanoleaf `8062849`; none is a physical result either. The Hub #231 scenarios
record fresh guards after a generation advance, a `stale-generation` race that
is not resubmitted, and one-step brightness and power forms. They also record
Reapply Work and Start Monitor against the fake controllers' same-mode and
participation behavior. None is a physical result.

Reproduce with `npm run build` and `npm run test:dashboard:browser` on Node 24.
The command emits its receipt and desktop/mobile screenshots outside Git under
`DASHBOARD_RECEIPTS`, default `/tmp/gh6-dashboard-receipts`.
