# Development and verification

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

## Runtime checks

The Automation browser journey uses the existing runtime harness with the real
Nanoleaf module over `SimulatedNanoleaf`. It checks explicit disabled creation,
enable/settings/edit/delete, passive drafts, one page-closed tracked moment,
named Free scene/brightness restoration, keyboard and axe. Read-only UI uses an
intercepted authority response; the gateway suite separately checks real reader
refusal. The `automation-lines-moment` catalog scenario adds reader resync and
restart without replay over both existing transports. No physical proof is claimed.

Automation gateway checks (`apps/runtime/tests/automation-gateway.test.ts`) cover
read/control admission, the required write header, bounded bodies, credential
revocation during a pending write and safe error/trace records. The route helper
tests preserve the existing CRUD/settings shapes. Both are discovered by
`npm run test:runtime:built` after the normal build and by the existing core CI
job; the Automation page's unit checks join `test:runtime-dashboard:built`.

`apps/runtime` is the current runtime and module host from
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md); its
[README](README.md) covers running it, health, state, failure
isolation and the event-loop lag check. It follows the
[strict profile](../../docs/development.md#strict-profile-for-new-code), tests included.

For the module frontend contract (Hub #932), the existing SDK manifest/kit
checks and runtime `gateway.test.ts` cover API 1.3 declarations, trusted asset
authentication and response policy, passive-page compatibility, read-only
command refusal and reads without device effects. After the root build, run
`node --test apps/runtime/dist/tests/gateway.test.js` for the gateway boundary.
These tests are already discovered by the core CI SDK/runtime commands below;
they do not replace the browser interaction or disposable Acceptance checks.
`frontend-build.test.ts` uses the production build plugin to bundle a synthetic
module's explicit browser entry and rejects one that imports its Node-side
implementation. Run it after the root build with
`node --test apps/runtime/dist/tests/frontend-build.test.js`; core CI's existing
runtime test discovery includes it. It starts no listener and keeps temporary
workspaces under the checkout's ignored `.local/scratch/frontend-build/`.

Use Node 24 and run `npm run build`, `npm run typecheck`, `npm run lint:js` and
`npm run test:runtime` from the worktree root. `test:runtime` builds, then runs
`test:runtime:built`: the compiled tests in `apps/runtime/dist/tests/`. The core
CI job runs `npm run test:runtime:built` after its fresh build. The tests use
in-test fixture modules, port 0 on loopback and private state directories under
the system temporary directory, which must be outside every Git checkout. Some
start the runtime in child processes, as the service manager would; one kills it
between the fixture lamp's commit and publish. The fixture lamp and chime run the
module test kit. Some start the runtime with `--edge` and `--simulate`: a remote
part with a run-generated credential reaches its gateway (#835), and
configurations without an edge section, and credentials files that are missing,
not private, malformed or that act as the core or a module, are refused. The
gateway tests cover each caller's grant, browser sign-in and its Origin checks,
credential reloads, MCP through `packages/mcp`, module pages and settings, the
route map against the old Hub's sources and the cutover's credential
conversion, and scan every record, answer, health document and span for the
synthetic token prefix `tok_SYNTHETIC835`. The
runtime's records must pass the diagnostic contract's validator (#903), as
maintenance intake reads them, and `runtime.stopped` must count no lost record or
span. The decision-record and tracing tests read the runtime's records and the
spans its host adapter hands a test sink (#949). The Pixoo library migration's
tool (#931) runs in process and as its entry point, against a synthetic library
it writes with the Pixoo module's code, starts the runtime in a child process to
show each one refusing the other's lease, and interrupts the entry point with
SIGINT and SIGTERM. Its full-disk test mounts small private tmpfs file systems
in a user and mount namespace (`unshare -rm`); a host that refuses one skips it
and says why. The Nanoleaf migration's tool
(#933) runs in process and as its entry point, against a synthetic bridge state
it writes with the Nanoleaf module's code, and starts the runtime in a child
process to show each one refusing the other's lease. Its full-disk test fills a
4 MiB tmpfs in a user and mount namespace (`unshare -rm`) at each stage of the
write, and skips with the reason where the host refuses that. The agent hook tests (#926) run `apps/runtime/bin/monitor-hook.mjs`
as child processes with synthetic 1.x producer files and synthetic Claude Code
payloads, against the runtime's gateway, a closed port and a listener that never
answers; they strip any `CLAUDE_CODE_*` variable and `CODEX_HOME` from the hook's
environment. The Codex Desktop tests
run the module's real reader process on a synthetic marker in a temporary Codex home, and make the marker a FIFO with `mkfifo` to stand in for a stalled mount.
No test reads a real client's hook settings or Codex files. They need no device
or network.
`node apps/runtime/scripts/measure-memory.mjs` measures the
zero-module memory for #123, and `measure-edge-memory.mjs` the edge under a
stalled reader; the README's Memory section says how.
`node apps/runtime/scripts/measure-commits.mjs` measures the SQLite commits,
blocked time and event-loop delay of the core's intake, a LIFX command and the
outbox (#972, #123); the README's Commits section says how.
`node apps/runtime/scripts/measure-hook.mjs` measures the agent hook from its
start to its exit against a disposable runtime's edge (#926); the README's
[Agent hooks](README.md#agent-hooks) section says how.

### Runtime test layers

Every runtime story is tested at four layers
([epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827)).
The core CI job runs the first three after its fresh build, on every PR that
runs the Checks workflow; Markdown-only changes skip them. The App verification
job judges the fourth layer's capture steps without a user manager.

| Layer | Command | What it runs |
| --- | --- | --- |
| Unit | Each package's own: `npm run test:sdk:built`, `npm run test:runtime:built`, `npm run test:nanoleaf:built`, `npm run test:pixoo:built`, `npm run test:playback:built`, `npm run test:lifx-module:built`, `npm run test:tidbyt-module:built`, `npm run test:codex-desktop:built` | The package's and its modules' own tests, moved tests included |
| Contract and conformance | `npm run test:events:built` | The profile 2.0 and core family fixtures. The SDK's transport conformance suite runs within `test:sdk:built`, and each module runs the module test kit within its own suite, as the fixture modules do in `test:runtime:built` |
| End-to-end | `npm run test:runtime:scenarios:built` | The runtime's scenario catalog in the in-memory harness, over both transports (tier 1) |
| Acceptance | `npm run -s verify:runtime -- <operation>`, with `npm run test:runtime:verify:built` in CI | The same catalog in disposable runs, for the Acceptance reviewer (tier 2) |

`npm run test:runtime:scenarios` builds, then runs
`test:runtime:scenarios:built`: the compiled tests in
`apps/runtime/dist/tests/scenarios/`. To run some scenarios only, name them
after a build, for example
`node --test --test-name-pattern=end-to-end apps/runtime/dist/tests/scenarios/*.test.js`.
Each catalog scenario runs twice in the runtime's module host, on a manual
clock: once with its parts on the host's bus, and once through a `RemoteEdge`
on 127.0.0.1 with run-generated tokens. The harness never listens on an
installed service's port (8765, 8787, 8788, 8791 or 41231), keeps its state in
a private directory under the system temporary directory, which must be
outside every Git checkout, and checks every message against profile 2.0. It
needs no device. The [runtime README](README.md#scenario-catalog)
describes the catalog and how a story adds to it.

The fixed Hub mode checks (#924) use synthetic Nanoleaf/Pixoo participants.
After the root build, use Node 24 and an outside-checkout `TMPDIR`:

```bash
node --test --test-concurrency=1 apps/runtime/dist/tests/mode.test.js apps/runtime/dist/tests/mode-participants.test.js apps/runtime/dist/tests/mode-runtime.test.js
node --test --test-concurrency=1 --test-name-pattern='MCP lists|Hub mode HTTP|a core the configuration refuses' apps/runtime/dist/tests/gateway.test.js apps/runtime/dist/tests/config.test.js
node --test --test-concurrency=1 --test-name-pattern='hub-mode over' apps/runtime/dist/tests/scenarios/catalog.test.js
```

These checks cover the durable selection, independent device outcomes, failed
saves, duplicates, explicit reapply, authorization and restart without replay.
The existing runtime and catalog CI suites discover them. The inbox-dependent
Acceptance journey uses the real inbox in a disposable run.

### Runtime verification runs

Hub #920 adds the runtime adapter for the
[app verification contract](../../docs/app-verification.md),
`npm run -s verify:runtime -- <operation>`. A run serves the runtime from the
checkout with `--simulate`, `--edge`, `--config` and `--environment test`,
either with the shipped module list or with the fixture modules, over simulated
devices, on loopback. The
[adapter README](verify/README.md) lists its run scenarios,
capture steps and boundary checks. After `npm run build`, with Node 24 from the
worktree root:

```bash
npm run -s verify:runtime -- help
npm run test:runtime:verify:built   # full suite, when the local scope below requires it
```

Choose local verification by the behavior changed, including its direct
consumers, rather than by file paths (owner decision, 2026-10-08):

- For a feature, fixture or catalog change, run focused tests for the changed
  behavior and its direct consumers, then exercise the affected catalog
  scenario or scenarios in a disposable run. Reuse those scenarios for the
  independent Acceptance review where it applies. Editing runtime source or a
  scenario file alone does not require the full local verification suite.
- Run `test:runtime:verify:built` locally when the change alters shared
  supervisor, isolation, lifecycle or run-adapter behavior across scenarios.
  This includes shared boundary guards and build-freshness checks. Run it alone,
  because it starts real runs; do not overlap it with another verification or
  Acceptance run.
- Documentation-only changes need no product run. Keep the applicable workflow
  and specification checks.

Build once from the candidate before its local `:built` checks and disposable
runs. Record the candidate revision, selected tests and scenarios, why they
cover the affected behavior, their results and any skips or evidence limits.
Required checks must pass. The [Acceptance review policy](../../docs/sdlc.md#acceptance-review)
still requires an independent reviewer and at most one run at a time on this
host. All runs keep synthetic data, simulated devices and an outside-checkout
`TMPDIR`; they grant no installed-system or physical-device authority.

The App verification CI job still runs the full `test:runtime:verify:built`
suite on every PR that runs the Checks workflow. Focused local verification
does not waive an applicable failed or missing CI job, contract check, browser
or accessibility check, or independent review.

`test:runtime:verify:built` starts runs without a user manager and judges every
capture step through `runCaptureStep`: one per catalog scenario, so the same
scenarios pass in the in-memory harness and in a run. It also starts each
boundary negative control and shows its check fails, shows the network guard
refuses `net`, `http`, `https`, `fetch` and `dgram` in a worker thread and a
child Node process too, and checks that `build-current` watches every source
the run loads. Nested module workspaces declared in the root package file are
also watched and included in the served candidate, with their declared built
import entries checked as outputs. They do not register as device modules.
It also judges the follow query of Hub #950, which reads one request's or trace's journal
records and spans in a run (see [Follow one request](verify/README.md#follow-one-request)),
and the runtime tests (`test:runtime:built`) cover the bounded, private span file that the
run's runtime writes. It starts the `nanoleaf-migrated` run (#933), whose seed migrates a synthetic Nanoleaf bridge
state into the run, and reads the migrated preferences through the run's gateway. It also checks that `start` and
`doctor` judge the runtime's own health as the in-memory harness does, and that the harness's refusals come from the
registry (#954). The host route takes the runtime as `--app runtime`. Its lifecycle tests drive
real transient units and skip with a printed reason without a user manager; the
App verification CI job runs the rest. It needs Playwright Chromium and an
outside-checkout `TMPDIR`, as the app verification tests do.


## Runtime dashboard checks

`apps/runtime/dashboard` is the B.U.N.N.Y. dashboard on the runtime (Hub #922),
copied from `apps/dashboard`; its [README](dashboard/README.md)
covers what it has and [PROVENANCE.md](dashboard/PROVENANCE.md)
what was copied and changed. It follows the
[strict profile](../../docs/development.md#strict-profile-for-new-code), tests included: `src/`
type-checks for the browser with its own `tsconfig.json`, and `tests/` for Node
with `apps/runtime/dashboard/tests/tsconfig.json`. Node 24 runs the tests' TypeScript as it is, with no
build step of their own.

Use Node 24 from the worktree root. `npm run build` builds the page into
`apps/runtime/dist/dashboard/`, after the SDK and the event contracts, and
`npm run typecheck` checks both projects.

The module-page tests cover catalog/build agreement and reuse of the shell's
connection, including read-only refusal and cleanup of active or late syncs.
The normal dashboard build also compiles the fixed frontend imports for the
browser. Real feature interactions and trusted iframe execution are verified
by the owning story's focused browser and disposable Acceptance checks.

```bash
npm run test:runtime-dashboard:built     # unit tests: routes, widgets, the session rows and the skin's tokens
npm run test:runtime-dashboard:smoke     # one trusted loopback page, about 2 s; CI's App verification job runs it
npm run test:runtime-dashboard:browser   # the full browser suite, local only
node apps/runtime/dashboard/tests/notice-clear.browser.ts # focused confirmed notice override
node apps/runtime/dashboard/tests/hub-mode.browser.ts <private-evidence-dir> # focused Hub mode controls
node apps/runtime/dashboard/tests/inbox-history.browser.ts # focused inbox actions and timeline
node apps/runtime/dashboard/tests/automation.browser.ts # fresh rules, one simulated moment and safe restoration
node apps/runtime/dashboard/tests/pixoo-pages.browser.ts # real playlist edit and trusted editor bundle
node apps/runtime/dashboard/tests/pixoo-upload.browser.ts # ordinary binary import, retained request and read-only refusal
node apps/runtime/dashboard/tests/pixoo-playlists.browser.ts # create, rename, options, items, order and deletion
node apps/runtime/dashboard/tests/pixoo-library.browser.ts # saved rendition rendering and media deletion without display writes
node apps/runtime/dashboard/tests/pixoo-player.browser.ts # frozen sessions, playback controls and explicit restart with changes
node apps/runtime/dashboard/tests/pixoo-monitor.browser.ts # title refresh, passive reads, presentation controls and Pixoo-only dismissal
node apps/runtime/dashboard/tests/pixoo-settings.browser.ts # safe setup projection and explicit brightness/screen commands
node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts # retained wall editor through authenticated tracked commands
```

The Nanoleaf editor check (#934) uses the actual module with a simulated Lines controller. It covers passive reads, local selection, tracked editing, read-only and Origin refusal, observed power, keyboard/accessibility, reduced motion and re-entry. The `nanoleaf-editor` catalog scenario runs through both tier-1 transports and disposable Acceptance. `test:nanoleaf:built` includes the literal-source Prism adapter test beside the compiled TypeScript tests; retained browser JavaScript does not require a second runtime build policy.

The core CI job runs `test:runtime-dashboard:built`. The browser checks use
Playwright Chromium against the built runtime in the test's own process, with
the core, its gateway on a free loopback port, a private state directory under
the system temporary directory, which must be outside every Git checkout, and a
synthetic hook that publishes lifecycle observations through the SDK edge. They
contact no device and no installed service. `smoke.ts` checks that the gateway
serves the built page, which signs in without a form, shows a synthetic
session's finished turn unread with the Hub mode and inbox panels, passes axe at
1,280 px and sends no command while it loads. The full suite (`browser.ts` and
`trusted.ts`) adds sessions appearing, an approval raised and cleared, a
finished turn that stays unread until the record clears it, a resync after a
lost stream with no replayed command, positive read evidence and a synthetic
device acknowledgment clearing rows without a page command, routes,
Places, axe at 1,440 and 390 px, a session that ends with a restart, Disconnect,
the launcher's code, the bookmark on either loopback name, a reload and a
second tab, and another local app's link, frame and hostile re-navigation
(Hub #561). The focused `controls.browser.ts` journey adds a simulated LIFX
control that shows accepted before completion, an uncertain write locked across
reload and read-only refresh without replay, a manifest-declared sign page in the
shell, Connections build identity, keyboard activation and desktop/phone axe.
It also runs directly with `node apps/runtime/dashboard/tests/controls.browser.ts`
after a build when the accepted local scope calls for only that changed journey.
The focused `inbox-history.browser.ts` journey checks explicit resend, dashboard
dismissal visible through MCP, timeline filters, keyboard and read-only access,
reload without replay, and desktop/phone axe scans.
Run the full suite when a change touches `apps/runtime/dashboard`, the gateway's
page or sign-in routes, or the SDK's remote client. Set `DASHBOARD_RECEIPTS` to
a directory to keep their screenshots.

The focused `hub-mode.browser.ts` journey uses synthetic participants to check
keyboard selection, the saved choice and each device's result, same-mode
reapply, a lost reply, read-only controls and reconnect/reload/restart without
replay. It runs axe on the changed panel and writes a screenshot to its optional
private evidence directory. It contacts no physical device.

The focused `pixoo-pages.browser.ts` journey uses the real Pixoo module with a
fresh synthetic library and simulated display. It checks a revision-bound name
save through the shared shell, owner-confirmed state, read-only refusal,
reload without resend, no display write and accessibility. It also executes a
separately bundled trusted editor fixture while retaining passive-page script
refusal. The full local browser command includes this journey and the Library,
Playlists, Player, Monitor and Settings journeys. They cover saved renditions,
referenced previews, explicit controls, read-only access and accessibility.
Monitor's synthetic Desktop module publishes metadata through its own SDK;
no provider files are read. This proves a title-only update reaches the page
without a manual refresh or a new command.

The `pixoo-pages` catalog scenario exercises declared React pages, passive
bounded reads and previews, one tracked playlist edit and a forged read-only
refusal. Run it in both catalog transports and through the disposable adapter;
independent Acceptance also uses the pages interactively. These are source and
simulator checks, not physical-display acceptance.
