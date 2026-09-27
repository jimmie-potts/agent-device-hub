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

Use Node 24 from the repository root. `start` serves the built candidate and
does not build: run `npm run build` first. The `build-current` check fails the
start when a tracked source under `apps/hub/src`, `apps/dashboard/src` or
`packages/*/src` is newer than the build it would serve. Use `npm run -s`, so
stdout carries only the JSON result line.

```bash
npm run build
npm run -s verify -- help
npm run -s verify -- start --scenario lifecycle-basic
npm run -s verify -- capture <run-id> command-reaches-fake
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
fake's observations come from the run's control listener (`GET /writes`),
which only the run's API token can read.

| Step | UI entry | Driver action | Scenario | Expected observation |
| --- | --- | --- | --- | --- |
| `task-appears` | Home, then the `wall` and `pixel` component pages | Open the preview; post a synthetic `question.continuing` event; browse both devices | `lifecycle-basic`, fresh | Signed in on load; the "Build the integration" session shows, then "Question · continuing"; no controller command; no link outside Places targets an installed port |
| `command-reaches-fake` | `pixel` component, Brightness slider | Set brightness to 30 | `lifecycle-basic`, fresh | Queued or Sent status; exactly one `brightness.set` of 30 reached the Pixoo fake; the slider shows 30 |
| `uncertain-no-replay` | `pixel` component, Brightness slider, Reload current values | Make the fake drop the response; set 25; wait 5.5 s; restore; reload | `lifecycle-basic`, fresh | "Result unknown … (uncertain-result)"; the form stays locked; one command, never retried; reload shows 60 and sends nothing |
| `offline-recovers` | `pixel` component | Open while the fake answers 503; restore it | `pixel-offline`, fresh | "Stale / unavailable", then recovery without a reload; no command |
| `control-duplicate-command` | `pixel` component, Brightness slider | Set 30 | `lifecycle-basic`, fresh | Negative control: expects two commands, sees one, reports `failed` |
| `control-installed-links` | `wall` component page | Open it with a seeded editor link to the installed wall | `control-installed-links`, fresh | Negative control: the installed-port link check catches the link and reports `failed` |
| `control-missing-session` | Home | Open the preview | `lifecycle-basic` | Negative control: expects an unseeded session, reports `failed` |

Runs serve no per-device editor links, so a preview never sends the owner to
an installed service's port. The dashboard's own Places navigation still
links to the installed B.U.N.N.Y. and wall (`docs/skins/places.json`),
because that is product UI. The link check excludes it, and a preview reader
should treat those two links as leaving the run.

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

- `steps.test.mjs` judges every step with `runCaptureStep` against a freshly
  seeded `serve.mjs` per step, without a supervisor: the four reference steps
  pass, and both controls fail for the stated reason. It needs only Chromium
  and runs in CI.
- `runs.test.mjs` drives the documented wrapper against real transient user
  units, with private roots:
  - start with build identity and checks;
  - a stateful capture and a failing control;
  - handoff with a reset whose preview a fresh browser opens signed in,
    without sending a command;
  - no run credential in any proof file or printed output;
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
