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
first. If the verification core is not built, the wrapper prints one JSON
result with `state: unavailable`, exits 3 and names `npm run build`; it creates
no preview. The `build-current` check fails the start when a tracked build source
is newer than the build it would serve. The sources are `apps/hub/src`,
`apps/dashboard/src`, the packages the hub imports (`agent-state`,
`contracts`, `lifecycle-contracts`, `mcp`, `app-verify`), `docs/skins/places.json` and
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
the run and prints the card and read-only proof URLs for the owner. Both the
ordinary fixture launcher and integrated CLI launcher mount the core's proof
handler on the Hub listener. Links expose only passed frozen captures, share
the preview's lease and stop boundary, and leave local proof unchanged.
Include those URLs in the handoff and attach the frozen media when supported;
filesystem links alone are not a reliable chat handoff. Opening the preview from the
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
| `task-appears` | Home, then the `wall` and `pixel` component pages | Open the preview; post a synthetic `question.continuing` event; browse both devices | `lifecycle-basic`, fresh | Signed in on load; the "Build the integration" session shows, then "Question · continuing"; no controller command; no link, Places included, targets an installed port |
| `command-reaches-fake` | `pixel` component, Brightness slider | Set brightness to 30 | `lifecycle-basic`, fresh | Queued or Sent status; exactly one `brightness.set` of 30 reached the Pixoo fake; the slider shows 30 |
| `uncertain-no-replay` | `pixel` component, Brightness slider, Reload current values | Make the fake drop the response; set 25; wait 5.5 s; restore; reload | `lifecycle-basic`, fresh | "Result unknown … (uncertain-result)"; the form stays locked; one command, never retried; reload shows 60 and sends nothing |
| `offline-recovers` | `pixel` component | Open while the fake answers 503; restore it | `pixel-offline`, fresh | "Stale / unavailable", then recovery without a reload; no command |
| `control-installed-links` | `wall` component page | Open it with a seeded editor link and a Places link to the installed wall | `control-installed-links`, fresh | Negative control: the installed-port link check catches both links and reports `failed` |
| `control-missing-session` | Home | Open the preview | `lifecycle-basic` | Negative control: expects an unseeded session, reports `failed` |

The reference steps must also fail on known-broken behavior. A scenario
seed's `fault` field selects one in `serve.mjs`. Only a seed file selects a
fault, never the environment, and an unknown fault refuses to start. CI's
`steps.test.mjs` judges the unchanged reference steps under each:

| Fault | Broken behavior | Reference step and the assertion that fails |
| --- | --- | --- |
| `write-on-read` | An unsolicited brightness command goes through the hub shortly after the Pixoo fake is first read | `task-appears`: "read-only browsing sent no controller command" |
| `duplicate-forward` | A loopback relay in front of the Pixoo fake forwards every command twice | `command-reaches-fake`: "the fake received exactly one brightness.set of 30"; `uncertain-no-replay`: "the uncertain command reached the fake once and was not retried" |
| `replay-on-recovery` | Clearing an offline Pixoo sends a brightness command through the hub; clearing an uncertain one re-sends the value the controller already holds (60), so the reloaded value is unchanged and only the count sees the replay | `offline-recovers`: "recovery sent no command"; `uncertain-no-replay`: "recovery replayed nothing" |

Runs serve no per-device editor links, so a preview never sends the owner to
an installed service's port. The dashboard's Places navigation follows the
run's own `placeLinks` (Hub #495). The standalone scenarios configure none,
so Places shows the four public documents and the current B.U.N.N.Y. place
and no "Wall · Local" link. In `integrated`, Wall leads to the paired wall
run. The installed-port link check therefore covers Places too.

The `control-startup-fails` scenario gives the hub an invalid
`browserAccess`, so `start` reports `failed` with no unit, timer or runtime
directory left. Its `failure.detail` ends with the hub's own stable cause,
`; app: hub-start-failed: invalid-configuration`, which the plug-in's
`readiness.failureCause` picks from the app's stderr; no other log text is
kept. Boundary checks at start, which `doctor` repeats:
`build-current`, and `no-installed-ports`, which confirms that no listener of
the run (the hub, the control listener, the fake controllers or a fault relay)
uses an installed port.

When the UI or a fake changes, update the step, this map and the
[dashboard checks](../../../docs/development.md#dashboard-checks) together.

## Integrated scenario and composed previews

The `integrated` scenario ([`integrated.mjs`](integrated.mjs)) runs the real
`apps/hub/dist/cli.js serve`, not the fake-controller fixture. Its
configuration has:

- the single agent-state owner, `verify-owner`;
- consumers `dashboard`, `nanoleaf` and `pixoo`;
- the paired runs' feed credentials, stored as digests;
- controllers `wall` (Nanoleaf `wall-controller`/`wall`) and `pixel` (Pixoo
  `pixoo-controller`/`pixoo-local`), called with the paired controller
  tokens;
- trusted-loopback sign-in;
- `placeLinks` pointing Wall at the paired wall run.

It needs four inputs (`nanoleaf-controller`, `nanoleaf-preview`,
`pixoo-controller`, `pixoo-preview`) and the four pairing credential files in
the run's runtime directory. So it is reached only by a reseed from
[`compose.mjs`](compose.mjs), the orchestrator described in
[Composed previews](../../../docs/app-verification.md#composed-previews):

```bash
npm run build
npm run -s verify:compose -- start --checkout nanoleaf=/abs/codex-nanoleaf --checkout pixoo=/abs/divoom-app-upgrade
npm run -s verify:compose -- capture <composition-id> integrated-lifecycle
npm run -s verify:compose -- capture <composition-id> integrated-command
npm run -s verify:compose -- capture <composition-id> one-owner
npm run -s verify:compose -- inject <composition-id> consumer-loss pixoo
npm run -s verify:compose -- handoff <composition-id>
npm run -s verify:compose -- reset <composition-id>
npm run -s verify:compose -- doctor <composition-id>
npm run -s verify:compose -- stop <composition-id>
```

Each consumer checkout must be clean at its pin in
[`compose.json`](compose.json), with its own dependencies installed and built
as its README says. For the wall, set `PYTHON` to a Python 3.12 or later
interpreter that has `requirements-controller.txt` installed. The Pixoo
wrapper runs under `fnm exec --using=.nvmrc`.

| Step | UI entry | Driver action | Scenario | Expected observation |
| --- | --- | --- | --- | --- |
| `reset <id>` (aggregate command) | Hub, wall and Pixoo previews | After a lifecycle/command capture and handoff, reset twice | `integrated` + two `hub-paired` runs | Both feeds drain before owner reseed; pages stay responsive while paused; the initial state returns, including a lower owner revision; readiness passes on the same run ids/ports/tokens; frozen hashes stay unchanged |
| `integrated-lifecycle` | Hub home and its Places Wall link, then the wall run's map and its B.U.N.N.Y. link, then the Pixoo run's Monitor tab, in one page; each link opens a new tab | Post `session.started` and `question.continuing` for a new session through the Hub's ingest route; click the Places Wall link, then the wall's B.U.N.N.Y. link | `integrated` | The Hub card shows the session and "Question · continuing". Both consumers follow the owner. The Places Wall tab is answered 200 and lists the session as `question`. The wall lists the session as `question` on a Line. Its B.U.N.N.Y. link leads to the paired Hub, and its tab is answered 200 and shows the dashboard signed in with the session. The Pixoo Monitor lists it. No link on the three pages targets an installed port. Neither writer received a command |
| `integrated-command` | `pixel` Brightness slider, then `wall` Layout style | Set brightness; switch the layout style | `integrated` | Queued or Sent. Exactly one `brightness.set` at the Pixoo writer. The wall's writer applies exactly one integration setting, with the physical outcome unknown. Nothing else reaches either writer |
| `one-owner` | The Pixoo run's Monitor tab | Post a session to the Hub; post another straight to the Pixoo run with the controller credential the Hub holds | `integrated` | The direct event is not accepted. The Pixoo follows the owner with exactly the Hub's sessions. Its Monitor lists the Hub's session and not the direct one |
| `pixoo-loss` | `pixel` component | Through `inject … consumer-loss pixoo`: ask for the freeze; a client that read before the loss sends brightness at a unique percent; post an event; leave the page; ask for the thaw; read the Pixoo first | `integrated` | `Stale / unavailable` and no enabled slider. Health says unavailable. The Hub answers `uncertain-result`. The owner advances past the Pixoo's revision. After the thaw the dashboard shows the Pixoo current, and both consumers follow the owner. Nothing but the loss-time command reached a writer, and that at most once: every counter is compared, and a delivery must carry the loss-time request id and percent and must have taken effect before the Pixoo answered its first read. `loss-command.json` records it all. Nothing more arrives afterwards |
| `control-replay-after-recovery` | `pixel` component | Through `inject … consumer-loss pixoo --step control-replay-after-recovery`: as `pixoo-loss`, then re-send the lost command as new work the moment the thawed Pixoo answers | `integrated` | Negative control: holds when it fails at "nothing but the loss-time command reached a writer, and that at most once" |
| `control-second-owner` | The Pixoo run's Monitor tab | Through `inject … second-owner pixoo`: the orchestrator reseeds the Pixoo to its embedded owner, the one-owner checks run, and the orchestrator restores `hub-paired` | `integrated` | Negative control: holds when it fails at "the Pixoo reads its sessions only from the Hub: current at the owner's revision, with exactly the Hub's sessions" |

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
- `compose.test.mjs` drives `compose.mjs` against real user units with
  this checkout's Hub and two stand-in consumer adapters
  ([`fixture-consumer.mjs`](tests/fixture-consumer.mjs)) in disposable
  pinned Git checkouts. It covers:
  - a pin mismatch and a dirty checkout failing before anything is created;
  - pairing and readiness;
  - `capture` and `inject` refusing any other step before a run changes;
  - `one-owner`, and the loss through `inject`;
  - both controls holding at their named assertions, the replay re-sent
    right after the thaw and the second owner an embedded stand-in Pixoo;
  - a Hub capture that dies mid-freeze: the consumer is thawed, the
    handshake cleared and a result printed with exit 3;
  - an orchestrator killed with its process group mid-freeze: the safety
    thaw runs within `--thaw-after` (at least 60 s), stopping the consumer
    if its current per-run lease has expired or cannot be verified;
  - a consumer whose lease could end while frozen is never frozen
    (`lease-too-short`);
  - a checkout that changes during `start` failing a pinned start;
  - a stop retried after one that could not stop a run;
  - extend, handoff, a unit left frozen in `doctor`, and stop with the Hub
    first;
  - expiry reported as `expired`, and a restart as a new composition linked
    by `--restarts`;
  - a partial start stopping only recorded runs in reverse;
  - an installed port announced during pairing;
  - a readiness timeout naming the silent consumer;
  - a crashed consumer in `doctor`;
  - `stop` continuing past a service it cannot stop.

  Its teardown thaws and stops every unit its private roots created,
  found by run directory, composition record and stand-in app name, because
  systemd refuses to stop a frozen unit. The stand-ins prove the
  orchestrator, not the real consumers; the local
  cross-repository run in [development](../../../docs/development.md#app-verification-and-preview-runs)
  does. Without a user manager it skips, like `runs.test.mjs`.
- `feed-pause.test.mjs` holds one acknowledgment and rejects stale identities,
  unsafe controls, missing drain evidence and expired leases without authorizing
  owner reset. The held-ack regression also fails under a deliberate early-reset
  mutation.
- `reset.test.mjs` checks aggregate contention, incomplete-phase diagnosis,
  dead-holder cleanup, orphan adapter descendants and a late runner whose parent
  already died. These checks need no user manager.
- The aggregate reset cases in `compose.test.mjs` use real user units. They
  reset twice after frozen captures, hold the owner seed to read the paused
  consumer pages/controllers, fail each phase and interrupt an active seed.
  They check lower revision recovery, stable identities and tokens, frozen
  hashes, truthful failure and owner-first cleanup.
- `lock.test.mjs` races eight processes for the composition lock
  ([`lock.mjs`](lock.mjs)) while some die holding it: no two live holders
  are ever inside at once, and a dead holder's lock is broken. It needs no
  systemd and runs in CI.

The hub keeps a Unix socket at `<state root>/<run-id>/data/h/bunny-launch.sock`,
which must stay under 108 bytes. The default state root,
`~/.local/state/app-verify`, leaves room; a longer override fails the start
with `hub-start-failed: socket-path-too-long`. The tests use a short root.

The safety-thaw regression tests cover per-run leases changed outside the
composition, expiry during a freeze, early safety thaw and removal of thaw
timers after an interrupted injection. `safety-thaw.test.mjs` checks the
receipt/timer decisions with a fake command boundary on every host;
`compose.test.mjs` also requires a real user manager to verify freeze, expiry
and cleanup. A skipped manager test is not evidence of that behavior.
