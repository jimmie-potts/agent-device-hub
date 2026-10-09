# Development and verification

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

These procedures concern the retained legacy system. Current runtime work starts
at [the runtime guide](../runtime/README.md). They authorize no installed-service or device changes.

## Standalone hub checks

Hub #5 targets Node 24 on Linux in WSL. Run `npm ci`, `npm run build`,
`npm run typecheck`, `npm run test:hub` and `npm run test:hub:package` from the worktree root, alongside
the shared controller/lifecycle/state/MCP and workflow suites. Both are
[old system checks](../../docs/development.md#old-system-checks) that run locally, not in CI. Tests use disposable private Linux state, synthetic credentials and
fake loopback controllers. They do not start installed services or operate
devices. The source includes supervised child release, fenced import, route readiness,
interrupted coordinator recovery and rollback tests. Full integrated performance
qualification remains #30; source checks do not install or activate personal hooks.
The hub and setup suites refuse a `TMPDIR` inside any Git checkout and fail
with `store-in-checkout`, so a task-scoped `.local/scratch` folder does not
work for them. Set `TMPDIR` to a folder under `~/.cache/agent-device-hub/` with a
short name, such as `~/.cache/agent-device-hub/gh916t`, before `npm run test:hub`
or `npm run test:setup`. Keep the `TMPDIR` path at most 48 bytes: a Hub test
binds a Unix socket 59 bytes below it, and a socket path stops at 107 bytes, so
a longer one fails with `listen EINVAL`.

Running build identity is covered by `apps/hub/tests/build.test.mjs` in the
Hub and extracted-package suites: metadata failures (including linked manifests), read authorization,
unhealthy status, manifest replacement and a real process restart across a
current-link switch. `test:hub:package` also runs
`scripts/hub-build-identity.test.mjs` against disposable Git repositories to
verify clean, dirty, missing and equal-version/different-commit provenance.
The extracted manifest must carry the package command's captured source identity.
The running packaged Hub must report that identity in health and dashboard context.
Complete dependency inventories and the 8 MiB manifest boundary are covered;
oversized or invalid metadata still reports unknown.

Hub upgrade command checks use `apps/hub/tests/install-*.test.mjs` through
`npm run test:hub` and `npm run test:hub:package`, which run locally, not in CI.
Use the private test TMPDIR
above. Fixtures cover approval drift, package/dependency inventories, compatible
latest-state recovery, both shared-layout adoption orders, interruption,
receipt finalization and owned retention. They use synthetic state and fake
service control; installed upgrade acceptance follows the exact-plan checkpoint
under [applicable authority](../../docs/sdlc.md#installation-and-evidence), including standing
authorization without a renewed human approval.
`install-service-contract.test.mjs` covers systemd omitting an empty
`EnvironmentFiles` property, binds a configured list and still rejects a missing
freeze capability. Its fake `systemctl` runs in an isolated child process.
`install-plan.test.mjs` also covers large protected Codex executables: streaming
fingerprints detect changed bytes, enforce a 256 MiB protected-file limit and
retain the 64 MiB default limit for release inventories.

Controller contract 1.1 reads for #576 are covered by
`apps/hub/tests/controller-versions.test.mjs` and the `status` case at the end of
`apps/hub/tests/mcp.test.mjs`, which `test:hub:built`, `test:hub:mcp:built` and the
packaged hub tests already include. They run over
loopback HTTP against the shared fake controller in
`apps/hub/tests/fake-controller.mjs` (`startFakeController({serves})`, with `'1.1'`,
`'1.0'`, `'1.0-negotiating'` and `'1.0-unknown-route'` (Nanoleaf's 404 refusal), epoch restarts, injected timeouts and 5xx answers,
and a log of every request and command). Import it from a test instead of writing
another ad hoc server; it is not a `*.test.mjs` suite. The cases cover negotiation
and the `1.0-only` verdict per controller epoch, unchanged 1.0 readers, the strict
`apiVersion` parameter on the snapshot route, MCP `status` and zero command POSTs.
No registered controller serves 1.1 yet, so these checks are fake-controller
evidence only; installed and controller-adoption acceptance stay with
codex-nanoleaf#158 and divoom-app-upgrade#92.

The moment sender for #335 is covered by `apps/hub/tests/moment-sender.test.mjs`,
the slot-wait cases in `apps/hub/tests/controllers.test.mjs` and the moment command
cases in `apps/hub/tests/controller-versions.test.mjs`, which the same hub suites
already include. The shared fake now admits commands
through the contract's reference `admit`, and its `answerNext`, `hold` and
`moments()` script a device's answer, stall a request and list the moment POSTs.
The cases inject the hub-monotonic clock and cover the bounded slot wait, the
request built from the snapshot, the not-sent reasons with no POST, ambiguous
answers with exactly one POST, independent devices and no command after a hub
restart. They are fake-controller evidence; a live moment needs a controller that
serves 1.1 and a caller such as #336 or #358.

The owner moment route for #336, `POST /api/controllers/v1/:id/moment`, is covered
by `apps/hub/tests/moment-route.test.mjs`, which `test:hub:built` and the packaged
hub tests already include. It runs against the shared
fake and covers:

- `forbidden` for `read` scope, another device grant and a missing mutation header;
- 400 `invalid-request` for a palette, an extra field, a bad mood ID or an
  out-of-range duration, with no controller request;
- `not-sent` with no command for an undeclared mood, a duration above the device
  limit, a 1.0-only controller and a controller without moments;
- exactly one POST with a fresh `momentId`, `event` and no palette for a valid press;
- failed receipts, a lost answer and a typed refusal passed through as typed;
- a controller that stalls past the route's 2.5 s bound, answered `uncertain`
  inside the 3 s cap with one request;
- a press that waits for the device slot and still sends once.

Playback for #175 and #233 is covered by `apps/hub/tests/playback.test.mjs`, which
`test:hub`, `test:hub:built` and the packaged hub tests already include through
the `apps/hub/tests/*.test.mjs` pattern. It runs the
shared playback module against fake sources with no speaker code, the Sony
module against a fake loopback receiver and the Sonos module against a fake
loopback AVTransport service. Freshness checks use a controlled clock. The #233
cases cover two sources under one playback ID: independent freshness, the
preference rule (Move alone, grouped, Sony alone, a Move that goes silent
mid-song staying stale and then yielding to the Sony), a command checked after
the presented source changed, and the rejected `selected` configuration form.
Route checks cover authentication, the configured target, unsupported controls,
duplicate and concurrent commands, failed/uncertain results and a hub with both
sources. The dashboard browser fixture and `mcp.test.mjs` use the same
configuration shape. These tests do not contact a speaker or phone. Installed
playback acceptance with a real iPhone, HT-A9 and Move needs separately
authorized speaker addresses and is recorded on the issue.

For owning-service acceptance, prepare the immutable revisions in
`apps/hub/fixtures/pixoo-source.json` and `nanoleaf-source.json` in disposable
checkouts. Build Pixoo with its Node 24 `npm ci` and `npm run build`.
Run from this hub worktree after building:

```bash
node scripts/check-hub-pixoo.mjs /absolute/prepared/pixoo
node scripts/check-hub-nanoleaf.mjs /absolute/prepared/nanoleaf
```

Both helpers verify pinned source hashes and use temporary simulator/test state.
Pixoo exercises native settings plus its actual producer, selected-source facade,
browser label/acknowledgment routes and renderer through cutover and fresh-store
rollback. Nanoleaf exercises the real HTTP settings service with a disposable
worker fixture. Native tokens never enter the printed receipt. These local
cross-repository checks complement CI's pinned fixtures and isolated package tests;
CI does not fetch another private repository with broader credentials.


## Shared monitoring setup checks

Hub #8 adds local setup operations to the hub package. `npm run test:setup`
builds and runs isolated configuration, credential and hook tests, which
`test:hub:built` also runs. The hub package check also
executes these tests in the offline installed archive. Use Node 24 on Linux/WSL.
These tests also refuse a `TMPDIR` inside a Git checkout; see
[Standalone hub checks](../../docs/development.md#standalone-hub-checks).
Temporary synthetic settings and fake transports never qualify personal hooks.

For the optional cross-repository source check, build the exact Pixoo archive
revision in `apps/hub/fixtures/pixoo-source.json`, extract the Nanoleaf revision
in `apps/hub/fixtures/nanoleaf-shared-source.json`, then run:

```bash
node scripts/check-hub-shared-consumers.mjs /absolute/pixoo-source /absolute/nanoleaf-source
```

The command verifies pinned source hashes and uses disposable state plus a
suppressed physical worker launch. It covers setup/revocation, two consumer
projections, fenced handoff, legacy selection and latest-state rollback.
It also runs ordinary unordered start/stop/next-start hooks, rejects late retired
activity and exercises Nanoleaf's actual manual acknowledgment without clearing
Pixoo's notice. The actual Pixoo pager and Nanoleaf stored projection receive
the same selected activity while retaining their independent presentation rules.
The existing `check-hub-pixoo.mjs` additionally verifies labels/notices,
acknowledgment and renderer continuity. These require separately available
source archives; neither is a personal installation or a physical check.

For Hub #137, `test:agent-state:built` includes current-status policy, retirement
eviction, old-export recovery, freshness/restart and TypeScript/Python snapshot
compatibility. The original ordinary-provider regression failed before the fix.
`test:setup:built` runs the packaged Desktop hook against the real host and reopens
the same synthetic store. `test:hub:package:built` repeats that check after an
offline archive installation. Both run locally, not in CI; `test:hub:built`
includes the setup tests. Run the pinned consumer check above locally as well. Publish new state
2.0.0 and Hub 0.2.0 archives with hashes and the merged source revision; preserve
previous release bytes. Package version changes do not change snapshot/storage 1.0.


## Standalone hub MCP checks

`npm run test:hub:mcp` builds and exercises the optional host MCP route with disposable storage, synthetic credentials and fake loopback controllers. The broader hub and installed archive tests also include these scenarios; all of them run locally, not in CI. Retain all shared MCP, contract and workflow checks. No test starts an installed agent or contacts a physical device.

The media cases cover alias-bound playlist start and controller v1 playback
actions, strict inputs, current control/device permissions, typed owner
rejections, replay and ambiguous results without automatic retries. The Hub
suites run these cases directly and in the offline hub archive.


## Hub automation checks

Hub #358 adds event rules, the interrupt set, event intake, arbitration and the
automation log. `npm run test:hub:automation` builds and runs
`apps/hub/tests/automation.test.mjs` on its own. The file also runs in
`npm run test:hub` and in the packaged hub tests through the
`apps/hub/tests/*.test.mjs` pattern. Set `TMPDIR` outside any Git checkout, as for the
[standalone hub checks](../../docs/development.md#standalone-hub-checks).

The tests use disposable private stores, synthetic credentials, a fake event
source, an injected target reader and a fake moment sender with the #335
single-device shape. They cover restart persistence and one-time seeding,
route scopes and typed errors, duplicate and replayed events, each arbitration
block, independent per-target hand-off with no retry, and the lifecycle
source. The shared fake controller scenarios run the composed reader and the
real `sendMoment`: blocked targets get no controller command, the capable
target gets exactly one 1.1 moment, and a typed refusal is logged without a
resend. No test starts an installed service or contacts a device. Also run the standalone hub, hub MCP and shared
monitoring setup checks above, plus the shared build, type, contract and
workflow checks.

Hub #426 adds `automation-metadata.test.mjs` to the same hub and offline-package
test patterns. It exercises the real intake and SQLite log with the PR and
meeting fixtures in `apps/hub/fixtures/moment-title-events.json`: bounded
Unicode display fields, credential rejection before deduplication, legacy log
rows, restart readback, blocked moments and duplicate/replay protection. The
fixture cases in `automation.test.mjs` also read the metadata through the
authenticated log route and verify that controller intents retain their strict
1.1 shape. The existing hub suites run both files.


## Bounded cross-device compatibility

Hub #9 adds verification tooling for the standalone Linux/WSL setup. Build this
Hub worktree with Node 24 using `npm ci` and `npm run build`. Prepare Pixoo at
`apps/hub/fixtures/pixoo-source.json` and Nanoleaf at
`apps/hub/fixtures/compatibility-nanoleaf-source.json` in disposable source
archives. Build Pixoo with Node 24 `npm ci` and `npm run build`; use system
Python 3.12 or 3.14 for Nanoleaf and installed Playwright Chromium for the browser.
Run from the Hub worktree:

```bash
node scripts/check-hub-compatibility.mjs /absolute/pixoo-source /absolute/nanoleaf-source /tmp/new-compatibility-report.json
```

The report path must be new. The runner records preflight failures, verifies the listed owning-source hashes,
and rebuilds Hub/Pixoo before importing their build output. It
starts disposable local services with fake physical boundaries, and drives the
real dashboard and MCP. It tests shared lifecycle semantics, labels, monitor
acknowledgment, native settings/modes, duplicate/late events, one disconnected
consumer and host restart. The JSON report records tested revisions, scenarios,
failures and cleanup. Retain failed reports; do not overwrite them on reruns.
To check whether one of its services or another node process is still running,
do not use `pgrep -f <pattern>`: it also matches the agent's own shell, whose
command line contains the pattern. Read `/proc/<pid>/cmdline` for each
candidate node process instead.

This local cross-repository check needs explicit prepared private sources; ordinary
CI retains its existing component, contract, browser and package tests without
adding private repository credentials. Run `npm run typecheck`,
`npm run test:hub:built`, `npm run test:dashboard`, `npm run test:dashboard:browser`,
`npm run check:workflow` and `npm run test:workflow` alongside the source check.
The Hub command includes `tests/compatibility_process.test.mjs`, which checks
forced process cleanup and failed preflight reports without private source
access.
No product code or contract changes are intended. The #30 performance report is
a separate required completion input. Source compatibility does not install
hooks, start an actual agent client or establish visible-device behavior.


## Everyday standalone qualification

Hub #30 adds `npm run test:performance:standalone` for report completeness,
negative acceptance and PID/network/mount confinement, including timeout and
detached-child cleanup. Use Node 24 and system Python 3.12/3.14 with bubblewrap.
The existing Ubuntu workflow job runs these checks after its namespace preflight.
They do not benchmark timing or fetch private consumer repositories. Run the
shared build/type, contract/lifecycle/state, MCP, hub, dashboard and workflow
checks alongside them; the actual specification inventory also includes
`standalone-monitor-qualification` once synchronized.

The separately authorized local command is `npm run qualify:standalone --` with
the arguments in [the qualification runbook](../../docs/performance-standalone.md). It
prepares pinned consumer sources, then measures only inside a disposable isolated
Linux namespace. Setup/build time is excluded from runtime timings. No installed
hook, agent client, physical device or live state is used. The report retains
failures and is not a substitute for installed or physical acceptance.


## Session retirement checks

Hub #218 added focused cases to the existing `test:agent-state`, `test:hub` and their packaged suites. Hub #241 parameterizes the owner, Tidbyt and dashboard cases over Codex Desktop, Codex CLI and Claude Code, and adds mixed-path and upgraded-store cases. Run their Python snapshot fixtures as well. The existing CI jobs include these paths; no new device job is needed. Cover atomic tree removal, one revision, released capacity, other paths preserved, old ends/events across restart and resume, history bounds, legacy import, stored accepted ends settled on startup, failed commits, archive admission with unavailable evidence, default snapshot 1.0 and opt-in 1.1. Existing fake-clock retention tests preserve the 24-hour fallback.

Run the focused Nanoleaf companion checks against its owning service, plus Pixoo/Tidbyt current-snapshot, empty-idle, reconnect and dashboard-removal scenarios. A consumer that retains task-specific state needs snapshot 1.1 generations to detect recreation between reads. Source checks do not establish installed-client timing or visible Line release.

The #218 source acceptance harness uses the existing Pixoo source pin and the Nanoleaf candidate pin in `apps/hub/fixtures/retirement-nanoleaf-source.json`. Prepare those exact sources on disk, install their declared dependencies, and build Pixoo. Then run:

```bash
node scripts/check-session-retirement.mjs /absolute/pixoo-source /absolute/nanoleaf-source /absolute/retirement-report.json
```

Set `RETIREMENT_PATH` to `codex/desktop` (the default), `codex/cli` or `claude/code` and run it once per path. It supplies actual owner snapshots to both consumers, checks the shared fixture corpus through Nanoleaf, and distinguishes healthy-empty reconnect from unavailable retained state. It launches no device worker. The existing Tidbyt publisher and dashboard browser jobs also exercise retirement on every path. Keep the standalone harness receipts alongside required CI; they are source evidence, not installed or physical acceptance.


## Shared title and project checks

Hub #424 adds lifecycle 1.1 and snapshot 1.2 corpora to the existing TypeScript
and Python checks. New state tests cover rename ordering, label provenance,
legacy projections and synthetic restart. Hook tests cover explicit version
selection, bounded Codex/Claude title reads, missing sources and content
exclusion. HTTP tests exercise the configured Desktop index and Unicode labels;
MCP and browser checks cover metadata exposure. The existing glob-based suites
include these tests; the Hub's run locally since #827. `test:dashboard:browser` also runs
`apps/dashboard/tests/session-metadata.mjs` for desktop/mobile candidates.

Run build/type, controller, lifecycle, state, agent-status, Tidbyt, LIFX,
local-controller, MCP, Hub, setup, dashboard and workflow checks, including both
language corpora and isolated packages. The local source-consumer compatibility
checks retain their pinned historical source revisions. Record installed and
physical acceptance separately; these fixtures establish neither.

The lifecycle 1.1.0 archive is built from the candidate source and bundled in
agent-state 3.4.0 with archive/manifest hashes. Hub 0.4.1 bundles those artifacts. Its controller-contracts 1.1.0 and Device MCP
1.0.1 dependencies come from their published archives in `vendor/`, checked
against fixed archive and manifest hashes; their original receipts are retained.
The Hub package check rejects a changed archive or rebuilt manifest, then runs
the installed package tests with the published dependencies.
Publication follows the reviewed merged revision, with immutable source/checksum
receipts and preserved prior release bytes. Packaging scratch is disk-backed
under `.local/scratch/package-archives`; runtime fixtures keep their small
private stores outside Git checkouts.


## Owner capacity checks

Hub #807 lets a new root task displace a finished child subtree without attention
when the owner is full. `packages/agent-state/tests/capacity.test.mjs` covers
displacement with descendants and two revisions, ranking by subtree evidence,
protection of running (`active`), real-hook `unknown` and attended subtrees,
rejection of a new child, events that create no root (acknowledgment, guarded
retired root, old observation, archived Codex Desktop conversation) and a failed
displacement commit. The glob-based `npm run test:agent-state` and the existing CI
jobs run it, so no new command or CI job is needed. Run the agent-state check set
listed above. Live admission while the installed owner is full is an installed
observation.


## Claude Desktop host session checks

Hub #784 adds lifecycle 1.2 (`packages/lifecycle-contracts/fixtures/lifecycle-v1.2.json`,
validated in TypeScript through the `/v1.2` subpath while the root module keeps rejecting 1.2)
and snapshot 1.3 (`packages/agent-state/fixtures/snapshots-v1.3.json`) corpora to
the existing TypeScript and Python checks. `host-session-provider.test.mjs` covers
Desktop, CLI, missing, malformed, oversized, throwing, child, Codex and
older-version environments. `host-session.test.mjs` in agent-state covers the
memory-only owner map, `/clear`, retirement, expiry, failed commits, restart and
durable 2.1 exports. The Hub's `host-session.test.mjs` reads the
on-disk store and checks it against the stored durable 2.1 schema. The setup,
setup-hook and MCP suites cover the 1.2 selection. The existing
glob-based suites run all of them, so no new command is needed. CI runs the
agent-state suites; the Hub's run locally since #827.

Run the build/type, contract, lifecycle, state, Hub, setup, MCP, package and
workflow checks listed above. Synthetic environments prove the mapping only;
whether installed Desktop hooks inherit the variables is installed-observation
evidence.

