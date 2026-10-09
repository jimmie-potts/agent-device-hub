# Legacy Hub verification checks

These checks cover the retained standalone Hub and composed previews.
For the current runtime, use [its development guide](../../runtime/DEVELOPMENT.md).
Run commands from the repository root with Node 24.

The Hub adapter ([`apps/hub/verify`](README.md)) runs the
real hub and dashboard with the dashboard fixture's fake controllers. Its
entry point is `npm run -s verify -- <operation>` after `npm run build`, and
its README keeps the feature map of steps, UI entries, driver actions,
scenarios and expected observations. Run `npm run test:hub:verify` with the
checks above and the Standalone hub and Dashboard checks, because the adapter
reuses `apps/dashboard/tests/fixture.mjs`. It is an
[old system check](../../../docs/development.md#old-system-checks) that runs locally, not in CI. It covers:

- its unsupervised step test judges the seven reference steps on the correct
  app and under each seeded fault (`write-on-read`, `duplicate-forward`,
  `replay-on-recovery`), plus the two `control-*` steps. Three of them are
  the Hub #336 moment steps (`moment-plays`, `moment-blocked-on-status`,
  `moment-uncertain-no-replay`) on the `moments` scenario;
- its build test checks the build-freshness sources against esbuild's
  dashboard inputs;
- its wrapper test checks the unbuilt core's single JSON result and exit 3,
  built delegation, and distinct reporting of a broken core dependency;
- its proof test checks both verification launchers, the unchanged installed
  CLI, same-port reuse, retained proof after shutdown and Chromium image/video
  loading. Core `tests/proof.test.mjs` checks commitment, checksum and path
  confinement, symlink refusal, methods, origins, ranges, later captures and
  failed captures. Both existing test globs include these cases;
- its run tests use real user units and skip there with the printed reason.

For #559, the real-manager run test also checks handoff URLs after reseed,
repeat handoff and stop. The focused expiry test proves that a frozen proof
URL closes when the run's own lease expires. Use `APP_VERIFY_REQUIRE_SYSTEMD=1`
on the owner host so these checks cannot pass by skipping. These are disposable
verification runs; no installed Hub or device is involved.

The Nanoleaf and Pixoo adapters document theirs in their own repositories.

Hub #495 composes one preview from the three adapters with
`npm run -s verify:compose -- <operation>`; see
[Composed previews](../../../docs/app-verification.md#composed-previews). The composition
tests (`apps/hub/verify/tests/compose.test.mjs`) run in
`npm run test:hub:verify`. They use real user units with stand-in consumer
adapters in disposable pinned Git checkouts and skip without a user manager.
They also check that a composition is
refused beside a live run and starts its own three runs under the one-run
guard (Hub #944). The safety-thaw cases also change a run's own lease
without updating the composition, expire it during a freeze, and verify stop
removes the timer and service after an interrupted injection.
`apps/hub/verify/tests/safety-thaw.test.mjs` covers lease decisions and command
ordering without a manager; it does not replace those real-unit cases.

Hub #557 adds portable pause/identity and operation-interruption checks in
`feed-pause.test.mjs` and `reset.test.mjs`, covered by the same CI test glob and
verify type check. Its additional `compose.test.mjs` cases cover reset success,
each failed phase and interrupted owner reseeding with real user units. Run
those with `APP_VERIFY_REQUIRE_SYSTEMD=1` on the owner host; a skipped case is
not qualification. The recorded qualification also retains the actual failing
held-ack mutation and orphan-adapter regression, so the checks can detect the
unsafe behavior they protect against.

Hub #649 adds core-written receipt regressions for default runtime labels and
ordinary shareable proof permissions. These run in the same portable test glob.
They preserve private runtime/control checks and reject unsafe proof ownership,
links, write permissions, oversized files and mismatched identity. Lease checks
use the same bounded receipt snapshot already checked by the reset guard.

The cross-repository check with the real consumers runs locally from this
worktree after `npm run build`:

1. Prepare each consumer at its pin in
   [`compose.json`](compose.json) as a detached worktree
   under disk-backed scratch:
   - codex-nanoleaf: `npm ci`, and a Python 3.12 or later virtual
     environment with `requirements-controller.txt`, exported as `PYTHON`;
   - divoom-app-upgrade: its Node 24.5 or later `npm ci`. Its adapter builds
     on `start`.
2. Run `start` with both `--checkout` paths, then
   `capture <id> integrated-lifecycle`, `capture <id> integrated-command`,
   `capture <id> one-owner`, `inject <id> consumer-loss pixoo`,
   `handoff <id>`, `reset <id>`, `doctor <id>`, another `reset <id>` and
   `stop <id>`. After each reset, require current feeds at the initial owner
   revision, unchanged run ids/ports/pairing tokens and frozen proof hashes.
   Read all three pages to confirm the changed session and device settings have
   returned to their seeded state.
3. Run the controls in a separate composition, so they never freeze or
   reseed the Pixoo of a preview already handed to the owner; otherwise run
   them after `handoff`:
   - `inject <id> consumer-loss pixoo --step control-replay-after-recovery`
     must hold at "nothing but the loss-time command reached a writer, and
     that at most once";
   - `inject <id> second-owner pixoo` must hold at "the Pixoo reads its
     sessions only from the Hub: current at the owner's revision, with
     exactly the Hub's sessions".

   `compose` exits 0 only for a held control and records the expected
   assertion. A control that exits 1 did not hold, whatever its reason.

For the reset qualification, `node apps/hub/verify/tests/qualify-reset.mjs
<nanoleaf-checkout> <pixoo-checkout> <new-evidence-directory>` automates the
three captures, handoff, two resets, page screenshots, feed/identity/token/hash
checks, the loss/replay/second-owner injections above, and owner-first stop.
Use a short disk-backed `TMPDIR` outside Git and
run through `fnm exec --using=.nvmrc --`. Its JSON record and raw command logs
must all pass; screenshots alone are not a pass. This driver uses disposable
runs and the manifest pins, and preserves evidence after cleanup.
Append `--host-defaults`, with absolute `PYTHON` and `FNM_BIN` environment
paths, to qualify the documented `verify:host --host` route using the core's
default runtime and canonical proof roots. This mode requires the same explicit
host authority as preview launches. It records command-unit cleanup, verifies
unchanged lease expiries, and copies each frozen proof set into its evidence
directory. It stops only the recorded composition; it never deletes the shared
runtime root. This default-storage case is required for receipt compatibility
changes; a private temporary-root fixture alone does not cover it.
It requests snapshot 1.2 for the shared session titles, confirms a changed title
is visible on each page before reset, then checks those titles are absent after
each reset. A portable real-Hub HTTP test covers that version negotiation;
the default snapshot 1.0 route continues to omit shared titles.

The delivery evidence records the composition id, its `composition.json`,
each run's verified set and the consumer revisions. Only the delivery
composition's runs are delivery receipts; a controls composition's runs are
not. A composition proves
simulated cross-service behavior only, not installed or physical
acceptance.
