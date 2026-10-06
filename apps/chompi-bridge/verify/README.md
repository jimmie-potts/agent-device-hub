# CHOMPI bridge verification runs

The CHOMPI bridge adapter ([#853](https://github.com/jimmie-potts/agent-device-hub/issues/853)) for the
[app verification contract](../../../docs/app-verification.md). The lifecycle comes from
[`@jimmie-potts/app-verify`](../../../packages/app-verify/README.md), unchanged; this directory supplies the plug-in
([`plugin.mjs`](plugin.mjs)), the process each run serves ([`serve.mjs`](serve.mjs), [`server.mjs`](server.mjs)) and
the control page ([`page/`](page)).

A run is the real bridge CLI from the checkout, `chompi-bridge run --simulate --desktop sim`, on the WSL host:

| Part | Kind | What it is |
| --- | --- | --- |
| Bridge | actual | The CLI with its routing core, slot store, lights, profile watcher and feed client |
| Control page | actual (test tool) | The loopback page and its harness API on the run's port |
| Controller | simulated | `ChompiSimulator`, speaking HID protocol v1 to the bridge |
| Desktop | simulated | `SimulatedDesktop` behind OS adapter interface version 3: Codex, Claude and another app |
| Hub feed | simulated | `SyntheticHub`, serving the sessions snapshot 1.3 and change stream with a run-generated token |

One loopback listener serves the page, its API (`/api/harness/...`) and the synthetic feed (`/api/monitor/v1/...`).
The run proves routing behavior. It does not prove Windows client fidelity: UI Automation trees, real focus timing,
Wispr and file hashes stay with the native check and the owner's installed checks.

## Boundaries

A run never opens a HID device, calls Win32 or UI Automation, or contacts an installed Hub or bridge. Every
title and text in it is synthetic. Three boundary checks prove this at `start` and in `doctor`:

| Check | Passes when |
| --- | --- |
| `no-hid-device` | The bridge runs on the simulator transport and never creates its HID transport. [`guard.mjs`](guard.mjs) refuses every `node-hid` load, and the check reports any attempt |
| `no-desktop-calls` | The OS adapter is the simulated desktop and the platform adapter is never created. The guard also refuses `koffi` and its `@koromix/*` prebuilds |
| `own-feed-only` | Every bridge request goes to the run's own origin with the run's token, and the single-instance lock is in the run's private data directory. The bridge's `fetch` refuses any other origin before it connects |

Each crossing ends differently. [`tests/boundaries.test.mjs`](tests/boundaries.test.mjs) starts all three and shows
that the matching check fails:

| Negative control | What crosses | What happens | Check that fails |
| --- | --- | --- | --- |
| `control-hid-device` | The bridge runs without `--simulate` | It creates its HID transport, and the guard refuses the `node-hid` load, so no device is enumerated or opened | `no-hid-device` |
| `control-desktop-calls` | The bridge runs without `--desktop sim` | It creates the platform OS adapter. On Linux that is the unsupported adapter, so nothing is refused and no Win32 or UI Automation call is possible; the check fails on the adapter count | `no-desktop-calls` |
| `control-installed-hub` | The bridge is pointed at the installed Hub's port (8788) | The run's `fetch` refuses every request before it connects | `own-feed-only` |

## Negative controls

Names starting with `control-` are negative controls, not catalog scenarios. Each must fail, and `help` and the
page label them that way:

- the three scenarios above, whose `start` fails with `check-failed` by design. They are start-only:
  `npm run -s verify:chompi -- start --scenario <control>` shows the failure on its own, while
  `scenario <run-id> <control>` and `handoff <run-id> --reset <control>` refuse with `start-only-scenario` (exit 2)
  before anything changes, because reseeding a running run into one would fail its check and stop the run;
- the capture step `control-attention-light`, which expects attention that no task has. A reviewer may run it on
  purpose to see a failing capture. Keep it out of a verified set that serves as delivery proof: capture it after
  `handoff`, or not at all, as the [app verification contract](../../../docs/app-verification.md#adapter-acceptance)
  describes.

## Entry points

Run at most one Acceptance run at a time on this host, because memory is the constraint
([docs/sdlc.md](../../../docs/sdlc.md#acceptance-review)); a composition counts as one run. Check with
`npm run -s verify:chompi -- doctor` (and the Hub's `npm run -s verify -- doctor`) before a `start`.

Prerequisites: Linux with a `systemd --user` manager and the repository's Chromium (`npx playwright install
chromium`). Run with Node 24 from the repository root, and build first: `start` serves the built candidate, and the
`build-current` check fails a start whose bridge sources are newer than the build.

```bash
npm run build
npm run -s verify:chompi -- help
npm run -s verify:chompi -- prerequisites
npm run -s verify:chompi -- start                                   # desk-basic: explore freely
npm run -s verify:chompi -- capture <run-id> controls-page
npm run -s verify:chompi -- capture <run-id> focus-and-send
npm run -s verify:chompi -- capture <run-id> scenario-<catalog id>   # reseeds that scenario first
npm run -s verify:chompi -- scenario <run-id> codex-card-structure   # reseed for manual exploration
npm run -s verify:chompi -- handoff <run-id> --reset desk-basic
npm run -s verify:chompi -- doctor
npm run -s verify:chompi -- stop <run-id>
```

Open the run's URL from `start` to use the page. Proof goes under the main checkout's `.local/evidence/verify/<run-id>/`.

## The control page

- **Controller.** The 15 slot keys, the 10 black keys, Record (the CHOMPI key), Play and Loop are buttons that
  carry their LED color and a name for it, for example "Slot 2, light idle". The run names each light by what its
  role can show (a slot state, Record's record color, the wheel's error flash), so a held Record reads "light
  record" even though the record and error colors are the same red. A key goes down while the mouse
  button, Space or Enter is held, and comes up on release. **Latch keys** makes each activation toggle a key, for
  holds such as Record or the release gesture. Knobs 1-4, the big wheel and volume each turn left or right by their
  "Counts per turn" (the wheel defaults to one card step, 6 counts) and click. **Unplug controller** unplugs and
  replugs the simulator. All of these inject protocol input through `ChompiSimulator`, so the bridge sees real
  reports.
- **Simulated desktop.** For each window: whether it is in front, the selected task, the composer's focus and text,
  the last submitted text, and an open card with its stops and focused stop. Controls bring a window to the front,
  type into or clear a composer, change its focus, open an approval or question card, close a card and select a task.
- **Synthetic Hub.** The sessions with their slots. Controls set activity or attention, end a turn (an
  unacknowledged completion notice), add a Codex or Claude task, restart the event stream and save a profile with
  another idle color or with the shipped colors.
- **Scenario.** A run seeded with a catalog scenario runs it once from its fresh state and lists each step's
  outcome. **Run scenario** stays disabled, with the reason shown, until the run is ready: the controller is
  connected, the feed is current and every seeded task holds a lit slot key. The run also waits for that before
  the first step. If the run never gets ready, it records a failed readiness step with what it saw.
- **Logs.** The desktop's key, link, card and dictation log, and the bridge's JSON log lines.

The page has no external requests. Its API accepts JSON from its own origin and host only, and every value is
checked. [`tests/page.browser.mjs`](tests/page.browser.mjs) checks keyboard operation, focus kept across refreshes
and axe (WCAG 2.1 A and AA) at 1440 px and phone width.

## Steps and scenarios

| Step | Scenario | Observation |
| --- | --- | --- |
| `controls-page` | `desk-basic` | Every control is labelled; both tasks hold lit slot keys; no axe violations; boundaries hold |
| `focus-and-send` | `desk-basic` | Space on the Codex slot key brings Codex to the front on the task with its composer focused; typed text goes out with one Play press; the bridge logs `sent` |
| `scenario-<id>` | `<id>` | The page runs the catalog scenario `<id>`; every step passes; the result is attached as `scenario-result.json` |
| `control-attention-light` | `desk-basic` | Negative control, not a catalog scenario: expects attention that no task has, so it fails |

The catalog is in [`src/sim/scenarios.ts`](../src/sim/scenarios.ts). Each scenario is a seed plus steps, each step
an action, an expectation within a time bound, or an observation that must hold for a while:
`send-front-window`, `record-dictation`, `claude-question-wheel`, `codex-card-structure`, `reconnect-no-replay`
and `profile-reload`. Tier 1 runs the same steps in memory on a manual clock:

```bash
npm run -s test:chompi-bridge:scenarios                    # all
npm run -s test:chompi-bridge:scenarios -- profile-reload  # by name
npm run -s test:chompi-bridge:scenarios -- --list
```

## Checks

```bash
npm run test:chompi-bridge:built          # includes the adapter contract, synthetic feed, flag and runner tests
npm run test:chompi-bridge:scenarios      # Tier 1 catalog
npm run test:chompi-bridge:verify:built   # boundary checks and every capture step through runCaptureStep
npm run test:chompi-bridge:browser        # control page browser and accessibility check
```

The last two need Playwright Chromium but no user manager. The App verification CI job runs both; the
contracts job runs the first two.
