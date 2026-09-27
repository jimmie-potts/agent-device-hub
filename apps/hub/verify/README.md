# Hub verification runs

The Hub adapter ([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494))
for the [app verification contract](../../../docs/app-verification.md). The
lifecycle comes from [`@jimmie-potts/app-verify`](../../../packages/app-verify/README.md);
this directory supplies the Hub's plug-in ([`plugin.mjs`](plugin.mjs)) and the
process each run serves ([`serve.mjs`](serve.mjs)).

A run is the real hub and B.U.N.N.Y. dashboard, with the fake loopback
controllers of [`apps/dashboard/tests/fixture.mjs`](../../dashboard/tests/fixture.mjs)
and synthetic lifecycle events. It never uses the installed hub, its
`host.json`, the installed ports or a device. The preview signs in through
`browserAccess: "trusted-loopback"`, so its URL carries no token. API checks
use run-generated credentials that `seed` writes with mode 0600 into the
run's private data directory; `stop` deletes them with the runtime directory.

## Entry points

Prerequisites: Linux with a `systemd --user` manager, and the repository's
Chromium (`npx playwright install chromium`). Use Node 24 from the repository
root, with `npm run -s` so stdout carries only the JSON result line.

`start` serves the built candidate and does not build, so run `npm run build`
first. The `build-current` check fails the start when a tracked build source
is newer than the build it would serve. The sources are `apps/hub/src`,
`apps/dashboard/src`, the packages the hub imports (`agent-state`,
`contracts`, `lifecycle-contracts`, `mcp`), `docs/skins/places.json` and
`scripts/build-dashboard.mjs`. `tests/build.test.mjs` proves that every input
esbuild bundles into the dashboard is among them.

Capture only the reference steps before `handoff`, so the verified set holds
only passed captures; the #496 delivery preflight rejects any other. CI's
`steps.test.mjs` already proves that the `control-*` steps fail and that the
reference steps fail on known-broken behavior. If you do run controls on a
handed-over run, their fresh reseeds change the preview: finish with
`npm run -s verify -- scenario <run-id> lifecycle-basic` before the owner
opens it.

```bash
npm run build
npm run -s verify -- help
npm run -s verify -- start --scenario lifecycle-basic
npm run -s verify -- capture <run-id> task-appears
npm run -s verify -- capture <run-id> command-reaches-fake
npm run -s verify -- capture <run-id> uncertain-no-replay
npm run -s verify -- capture <run-id> offline-recovers
npm run -s verify -- handoff <run-id> --reset lifecycle-basic
npm run -s verify -- doctor
npm run -s verify -- stop <run-id>
```

`start` prints the run id, URL, port and build identity (`sourceRevision`,
`dirty`, the `/dashboard.js` digest) and, on stderr, the preview card. A
`dirty` run labels itself and is not a merge candidate's proof. Each capture
writes `after.png`, `interaction.webm` and `assertions.json` under the
canonical checkout's `.local/evidence/verify/<run-id>/`, and `capture` exits
non-zero unless every assertion passed and the video was finalized.
`handoff` freezes those captures into `verified/` with `SHA256SUMS`, reseeds
the run and prints the card for the owner. Opening the preview from the
Windows browser is [#497](https://github.com/jimmie-potts/agent-device-hub/issues/497)'s
qualification.

## Feature map

Scenarios are seeded by [`plugin.mjs`](plugin.mjs) and served by
[`serve.mjs`](serve.mjs). Steps marked fresh reseed their scenario first. The
fakes' observations come from the run's control listener, which only the
run's API token can read. `GET /commands` lists every command-shaped request
a fake received, including those it refused while offline or uncertain.
`GET /writes` gives the parsed commands. Count checks wait until the count has
held still for a second, so a late command is counted.

| Step | UI entry | Driver action | Scenario | Expected observation |
| --- | --- | --- | --- | --- |
| `task-appears` | Home, then the `wall` and `pixel` component pages | Open the preview; post a synthetic `question.continuing` event; browse both devices | `lifecycle-basic`, fresh | Signed in on load; the "Build the integration" session shows, then "Question · continuing"; no controller command; no link outside Places targets an installed port |
| `command-reaches-fake` | `pixel` component, Brightness slider | Set brightness to 30 | `lifecycle-basic`, fresh | Queued or Sent status; exactly one `brightness.set` of 30 reached the Pixoo fake; the slider shows 30 |
| `uncertain-no-replay` | `pixel` component, Brightness slider, Reload current values | Make the fake drop the response; set 25; wait 5.5 s; restore; reload | `lifecycle-basic`, fresh | "Result unknown … (uncertain-result)"; the form stays locked; one command, never retried; reload shows 60 and sends nothing |
| `offline-recovers` | `pixel` component | Open while the fake answers 503; restore it | `pixel-offline`, fresh | "Stale / unavailable", then recovery without a reload; no command |
| `control-installed-links` | `wall` component page | Open it with a seeded editor link to the installed wall | `control-installed-links`, fresh | Negative control: the installed-port link check catches the link and reports `failed` |
| `control-missing-session` | Home | Open the preview | `lifecycle-basic` | Negative control: expects an unseeded session, reports `failed` |

The reference steps must also fail on known-broken behavior. A scenario
seed's `fault` field selects one in `serve.mjs`. Only a seed file selects a
fault, never the environment, and an unknown fault refuses to start. CI's
`steps.test.mjs` judges the unchanged reference steps under each:

| Fault | Broken behavior | Reference step and the assertion that fails |
| --- | --- | --- |
| `write-on-read` | An unsolicited brightness command goes through the hub shortly after the Pixoo fake is first read | `task-appears`: "read-only browsing sent no controller command" |
| `duplicate-forward` | A loopback relay in front of the Pixoo fake forwards every command twice | `command-reaches-fake`: "the fake received exactly one brightness.set of 30"; `uncertain-no-replay`: "the uncertain command reached the fake once and was not retried" |
| `replay-on-recovery` | Clearing an offline or uncertain Pixoo re-sends a brightness command through the hub | `offline-recovers`: "recovery sent no command"; `uncertain-no-replay`: "recovery replayed nothing" |

Runs serve no per-device editor links, so a preview never sends the owner to
an installed service's port. The dashboard's own Places navigation is product
UI (`docs/skins/places.json`). Its only anchor is "Wall · Local", which leads
to the installed wall at `http://127.0.0.1:8765/`; "B.U.N.N.Y. · Local"
renders as the current place, with no link. The link check excludes the
Places navigation, and a preview reader should treat "Wall · Local" as leaving
the run. Hub #495 owns pointing preview Places links at the paired runs.

The `control-startup-fails` scenario gives the hub an invalid
`browserAccess`, so `start` reports `failed` with no unit, timer or runtime
directory left. Its `failure.detail` ends with the hub's own stable cause,
`; app: hub-start-failed: invalid-configuration`, which the plug-in's
`readiness.failureCause` picks from the app's stderr; no other log text is
kept. Boundary checks at start, which `doctor` repeats:
`build-current`, and `no-installed-ports`, which confirms that neither the hub,
the control listener nor any fake controller uses an installed port.

When the UI or a fake changes, update the step, this map and the
[dashboard checks](../../../docs/development.md#dashboard-checks) together.

## Checks

`npm run test:hub:verify` builds, then runs [`tests/`](tests):

- `steps.test.mjs` judges steps with `runCaptureStep` against a freshly
  seeded `serve.mjs` per step, without a supervisor. The four reference steps
  pass on the correct app and fail at their named assertions under each
  fault above; the two `control-*` steps fail for their stated reasons; and no
  run credential appears in any of their logs. It needs only Chromium and runs
  in CI.
- `build.test.mjs` shows that a newer package source, Places manifest or
  dashboard build script fails `build-current`, and that every esbuild input
  of the dashboard is a build source. It runs in CI.
- `runs.test.mjs` drives the documented wrapper against real transient user
  units, with private roots:
  - start with build identity and checks, and `help`;
  - a stateful capture and a failing control;
  - `extend`, whose new lease timer the receipt records;
  - handoff with a reset whose preview a fresh browser opens signed in,
    without sending a command;
  - `restart`, naming its predecessor and its continuity;
  - no run credential, including each rotated token, in any proof file or
    printed output;
  - two concurrent runs, where reseeding one leaves the other's sessions and
    process unchanged;
  - a hub that refuses to start;
  - a run that keeps serving after the scope that started it is stopped.

  Without a user manager, as on Depot's runner, it skips with the printed
  reason.

The hub keeps a Unix socket at `<state root>/<run-id>/data/h/bunny-launch.sock`,
which must stay under 108 bytes. The default state root,
`~/.local/state/app-verify`, leaves room; a longer override fails the start
with `hub-start-failed: socket-path-too-long`. The tests use a short root.
