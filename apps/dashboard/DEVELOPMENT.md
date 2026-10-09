# Development and verification

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

These procedures concern the retained legacy system. Current runtime work starts
at [the runtime guide](../runtime/README.md). They authorize no installed-service or device changes.

## Dashboard checks

Hub #471 adds `apps/dashboard/tests/wispr.test.mjs` to the unit glob and
`apps/dashboard/tests/wispr.mjs` to the existing browser matrix.
After `npm run build`, run `node apps/dashboard/tests/wispr.mjs` for the focused
real synthetic SQLite collector → aggregate files → authenticated Hub → browser
check. Use the outside-checkout `TMPDIR` documented under Standalone hub checks;
this fixture uses the real private Hub store. `DASHBOARD_RECEIPTS` retains synthetic
screenshots. The check covers hand-calculated totals, stages, separate edit pairs,
numeric downloads, independent home/page filters, permission retirement and
responsive accessibility. Unit tests cover preset coverage, missing values and
in-flight snapshot/opt-out guards. No personal database or installed service is used.

Hub #6 uses Node 24 and React/TypeScript. Run `npm ci`, `npm run build`,
`npm run build:dashboard`, `npm run typecheck:dashboard`, `npm run test:dashboard`
and `npm run test:dashboard:browser`. Browser checks use Playwright Chromium,
synthetic state and fake controllers. No check installs a personal service,
opens live state or contacts hardware. A change to
`apps/dashboard/tests/fixture.mjs`, to a fake it serves, or to UI that a
[Hub verification](../hub/verify/README.md) step drives also runs
`npm run test:hub:verify`.

Since #827, CI runs only the unit tests (`npm run test:dashboard`, in the core
job) and a smoke check (`npm run test:dashboard:smoke`, in the App verification
job). The full browser suite took 500 s in CI, so it runs
locally: run `npm run test:dashboard:browser` when a change touches
`apps/dashboard`, its fixture or fakes, or the Hub code they drive, and when
#922 copies the dashboard into the runtime.

`apps/dashboard/tests/smoke.mjs` opens one trusted-loopback page on the
fixture's Hub and checks that:

- the Hub serves the built dashboard, which opens signed in without a login form;
- the home renders the fixture's session and its `wall` and `pixel` widgets
  without sending a device command;
- axe finds no WCAG 2.1 A or AA violation on the home at 1,280 px;
- choosing Quiet in the `wall` widget's mode select sends exactly one guarded
  `mode.set` command with the snapshot's request ID, configuration revision and
  generation.

It takes about 2 s locally. The runtime's copy (#922) follows the same pattern:
a short smoke check in CI and its full browser suite as a local check; see
[Runtime dashboard checks](../../docs/development.md#runtime-dashboard-checks).

The browser matrix's `running Hub build` cases check Connections with synthetic
known metadata and an older context without a build field. They cover read-only
inspection, full revision copying and clipboard failure, unknown fallback,
desktop/mobile accessibility and zero device commands. Set `DASHBOARD_SCENARIO`
to `running Hub build` to run these cases alone; set `DASHBOARD_RECEIPTS` to an
evidence directory to retain their screenshots. Actual process identity is
verified separately by the Hub tests described above.

Hub #179 extends `npm run test:hub`, `npm run test:dashboard:browser` and
`npm run test:hub:package` with disposable owner-launch and browser-session
checks. Cover single-use and expired codes, rejected cross-origin exchanges,
read/control alias bounds without ingest/admin/MCP access, disconnect, reload
and inspection without device writes. They run on Node 24 and do not use the
installed Hub.

Hub #276 adds `apps/hub/tests/trusted-loopback.test.mjs` to `npm run test:hub`
and `apps/dashboard/tests/trusted.mjs` to `npm run test:dashboard:browser`.
They cover the session route off by default, invalid `browserAccess` values,
refused Host, Origin, fetch-metadata, header and body cases, the `localhost`
alias, launcher-equivalent grants without ingest/admin/MCP, the shared session
limit and retirement, and in Chromium sign-in on load, reload, second tab,
`pagehide` logout, eviction recovery, Disconnect, a failed request and the
unchanged page without the option. They do not use the installed Hub.

Hub #561 adds `apps/hub/tests/linked-navigation.test.mjs` to `npm run test:hub`
and the packaged hub tests, and a linked-navigation block to
`apps/dashboard/tests/trusted.mjs`. The hub test covers the page route's
fetch-metadata cases. A same-site top-level document navigation loads `/` on
either loopback name. Every page response refuses framing and sends
`Cross-Origin-Opener-Policy: same-origin`. Cross-site, framed, fetched,
Origin-carrying and foreign-Host requests are refused. The assets, the API
routes, the session route and the launch exchange refuse same-site requests.
In Chromium, another loopback app's link opens the dashboard signed in in a new
tab, while a link from another host name and an iframe are refused. A negative
control has a page on another loopback port re-navigate a window it opened to
the Hub every 10 to 30 ms. The owner's session must survive and the Hub must
hold at most two sessions; without the opener policy the owner is evicted
within about two seconds.

Hub #244 adds `apps/hub/tests/browser-sessions.test.mjs` and
`apps/hub/tests/replay.test.mjs` to `npm run test:hub` and the packaged hub
tests. They repeat launch, monitor read, command and logout, then cover expiry
and oldest-session eviction. Session, ledger, stream and replay counts must
return to the configured-credential bound. A configured credential's logout
keeps its tickets and streams. A monitor, controller or integration write whose
body arrives after logout is refused before any controller call, as is a late
write from a configured credential rotated in the meantime.
Deferred fake operations cover a pending command that resolves, rejects or
outlives its caller after retirement.

Hub #151 extends the matrix with general-control scenarios: one guarded command
per control in Media, Monitor gating with the explicit Media switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. The hub dashboard test
checks that general commands are schema-validated and scoped before any
controller request. The fake Pixoo declares the capabilities of Pixoo `main`
`c81bc31`, with controller v1 modes unsupported; the dashboard README records
the mapping. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #323 adds a read-only Nanoleaf scenario to the same matrix, using the
fixture's optional `panels` component. `apps/hub/tests/integration.test.mjs`
checks that a read-only extension snapshot validates and passes through the
integration route.

Hub #153 adds Nanoleaf scenarios to the same matrix: power and brightness in
Work with the override hint, Work gating with the explicit Free switch through
the controller v1 mode command, one guarded scene command with a preserved
selection and focus across reconnect, keyboard focus kept through the Free
switch, a scene activation and a locked draft form, and a controller-side scene
rejection, revision conflict and uncertain result with no retry. The fake Nanoleaf declares
the capabilities of Nanoleaf `main` `8062849` and rejects a scene outside Free
with `unsupported-capability` before any write; the hub route test checks that
scene commands are schema-validated before forwarding. Client unit tests cover
the scene availability order, name-or-ID labelling from the integration snapshot
and the Work/Quiet/pending/unknown gating. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #355 adds `apps/dashboard/tests/art.test.mjs` to `npm run test:dashboard`
and `apps/dashboard/tests/art.mjs` to `npm run test:dashboard:browser`. The fake
Nanoleaf controller serves a 15-Line, 12-connector layout and, with the
`panels` option, an 18-triangle NL22 layout on the read-only geometry route, or
an explicit empty layout, a 404 like an owner that predates the route, a
hub-valid layout the renderer rejects, or one transport failure before the
layout. The browser check covers the drawn Lines with reservation colors and
labels, keyboard selection shared with the mapping form, pending marks, one
geometry read per session, a stale controller, the Panels with their controller
offline, the schematic fallbacks, the retried read, reads only and axe at
1280 px and 390 px, then drives status, activity, mode, the opening assembly and
reduced motion through a component harness bundled from `tests/art-harness.tsx`.
Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #231 adds matrix scenarios for fresh guards and one-step settings:
- A controller generation advance between render and activation sends one
  command with current guards, and an open draft shows no conflict.
- A generation advance after the fresh read is shown as `stale-generation` and
  is not resubmitted.
- Accepted brightness and power changes leave their forms ready for the next
  change. Uncertain results still lock until an explicit reload, with keyboard
  focus on the reload button.
- Reapply Work sends one Nanoleaf mode command that ends an override, and a
  same-mode command with nothing to reapply is shown as already in effect.
- Start Monitor sends one Pixoo integration Monitor command, names the
  screen-off reason and leaves no empty block once Monitor is presenting.

The fake controllers reject a generation mismatch as `stale-generation`. The
fake Nanoleaf follows Nanoleaf `main` `08b6b83` same-mode handling, including
the configuration revision advance on admission, and the fake Pixoo reports
participation like Pixoo `main` `01da65d`. Client unit tests cover the status
wording and lock rules, including that only a same-mode reapply reports a
cancel as already in effect. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #245 moves the command lifecycle shared by draft forms and one-click actions
into `apps/dashboard/src/lifecycle.ts`. `apps/dashboard/tests/lifecycle.test.mjs`
runs under `npm run test:dashboard` and applies each case to both consumers:
- blocked and failed preparation;
- accepted, queued and terminal receipts;
- definite rejection, where another client's receipt is never adopted;
- uncertain and partial locks with explicit reload;
- a failed refresh after a result, and a stale read reaching the controller once.

A matrix scenario checks end to end that user-visible behaviour is unchanged on
the Pixoo brightness form and the Pause action. A failed device read before
sending sends nothing, recovery sends one command with current guards, a failed
read after an accepted command keeps its receipt, and a double click sends one
command. The app's reads resolve with an error record rather than rejecting, so
the rejected-promise paths are covered by the unit tests.

Hub #37 adds a now-playing matrix scenario with a fake Sony receiver behind the
fixture's hub. It covers only declared controls (no Play), one Next command,
paused Next/Previous with the stale-title note, a receiver refusal, an uncertain
result that locks without retry, a read-only credential, stale and unavailable
snapshots, and the view disappearing with no further playback reads once the
grant is removed. Client unit tests cover the button and reason rules, the
fresh-read command builder and the receipt mapping. The hub's `playback.test.mjs`
covers the launcher session's playback grant, the context field and the paused
Sony declaration. `mcp.test.mjs` covers the source-bound playback tools:
discovery by scope and grant, `hub_devices`, duplicate request IDs, typed
rejections, uncertain results, credential changes and a staged hub. None
contacts a receiver. The
owner's 2026-09-25 paused-state live check is recorded in the issue's refined
acceptance and in PR #275. Installed browser and Codex MCP acceptance come after
merge under the applicable [installation authority](../../docs/sdlc.md#installation-and-evidence)
and are recorded on the issue. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #277 makes the dashboard a dense control surface. `apps/dashboard/tests/routes.test.mjs`
and `widgets.test.mjs` run under `npm run test:dashboard`; the browser suite
adds the first-screen, width-reach, route, alias-collision, unknown-address and
1,280 px height checks, and the matrix and local-controllers suites address
navigation links and open the Details disclosure where a fact moved behind it.
Hub #444 extends the existing Dashboard browser check with six registered
components. Their full widget bounds must fit the first screen at the owner's
2,133 × 1,200 viewport, 1,440 × 900 and 1,280 × 720; merely starting in view
is insufficient. The check also looks for text overlap at all three desktop
sizes and keeps the 390 px Home check. It uses disposable Hub and fake-controller
fixtures and contacts no physical device.
The owner's design decision on the candidate removes the Apply buttons: the
suites drive a select, slider, text field or Power button directly, a matrix
scenario checks the home widget's quick actions, the shared lock and running
state between the widget and the page, the surviving session draft and the skip
link, and the lifecycle unit test carries the form wording. The overlap check ignores closed disclosures. Full-page height at
1,280 px is recorded in the browser receipt. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Hub #336 adds the Moments card. `apps/dashboard/tests/moments.test.mjs` runs
under `npm run test:dashboard` and covers the capability, mood, preset and
undeclared-line rules, every result line, the live line in the controller clock
and the lifecycle's `interpret` and `describe` hooks. `apps/dashboard/tests/moments.mjs`
joins `npm run test:dashboard:browser`. It drives the fixture's `moments` option,
a wall that serves controller contract 1.1 and uses the contract's reference
`admit` and `moment` operations as its admission and writer on a live device
clock. The suite covers:

- card presence and the home widget;
- the menu, presets and switch;
- one send per press, menu choice and preset, with a keyboard menu step that
  sends nothing until Enter;
- blocked, missed and 1.0-only lines;
- the uncertain lock with focus on the reload;
- supersede;
- the live line from scheduled to playing to each ending;
- the faster refresh stopping within 5 s of the end and never on a hidden page;
- axe at 1,280 px and 390 px.

The existing matrix and local-controller suites now expect moments in the
undeclared line. The device page reads `?apiVersion=1.1`, which 1.0 fakes answer
unchanged. Hub verification adds the three moment steps above. Record current-candidate UI evidence under the
[UI verification policy](../../docs/sdlc.md#ui-approval-scope).

Browser suite gotchas, learned in #277:

- Chromium compiles the `pattern` attribute with the `v` flag, so an unescaped
  hyphen at the end of a class such as `[A-Za-z0-9_.-]` makes the pattern fail
  to compile, and the browser silently skips it. Write `[A-Za-z0-9_.\-]`. The
  Project ID field had this since #151 and the hub's own validation masked it.
- The suites use `page.locator('section:visible')` and expect exactly one
  match, so a page must never nest a `<section>`; panels are
  `div[role=group]`. Every page except Connections stays mounted and hidden, so
  an unscoped exact-text lookup can match the hidden home. Scope it to the
  visible section.
- `textOverlaps` in `apps/dashboard/tests/layout.mjs` must skip the content of a
  closed `<details>`, which Chromium still reports with boxes.
- Playwright's `fill()` on a range input dispatches only `input` and `change`,
  with no pointer or key events. `getByLabel('X', {exact: true})` fails for
  `<label>X<select>` because the option text joins the label; use
  `getByRole('combobox', {name})`.

