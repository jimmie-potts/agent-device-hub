# @jimmie-potts/app-verify

The shared lifecycle core for disposable app verification runs. It implements
the operations, receipt, storage roots, supervisor, lease, doctor, frozen
proof, capture harness and preview card of the Hub's
[app verification contract](../../docs/app-verification.md) once, with no
knowledge of any application. An adapter supplies one plug-in object and a
two-line wrapper. [ADR 0009](../../docs/decisions/0009-app-verification-runs.md)
records the decisions. The archive carries copies of both documents as
`app-verification.md` and `adr-0009-app-verification-runs.md`.

Callers: the Hub adapter
([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494)), the
Nanoleaf wall ([codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193))
and Pixoo ([divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118)).

Requirements:

- Linux with a `systemd --user` manager. The core reads the output of
  `systemctl --user is-system-running`: `running` and `degraded` are usable.
- Node.js 22 or later. The suite runs on Node 24 in CI and was also run on
  Node 22.22.1.
- For `capture` and `runCaptureStep`: Playwright 1.50 or later with its
  Chromium and ffmpeg, installed by the consumer (`npx playwright install
  chromium`). Playwright is an optional peer dependency; the core never
  bundles a copy. The package has no runtime dependencies.

## Adopt it

Inside the Hub monorepo the package is the workspace `packages/app-verify`.
Other repositories vendor the release archive the same way they vendor the
other Hub packages:

```bash
gh release download app-verify-v1.0.0 --repo jimmie-potts/agent-device-hub \
  --pattern 'jimmie-potts-app-verify-1.0.0.tgz*' --dir vendor
(cd vendor && sha256sum -c jimmie-potts-app-verify-1.0.0.tgz.sha256)
npm install --save-dev file:vendor/jimmie-potts-app-verify-1.0.0.tgz
```

Then add a wrapper, for example `scripts/verify.mjs`:

```js
import {runCli} from '@jimmie-potts/app-verify';
import plugin from './verify-plugin.mjs';
process.exitCode = await runCli(plugin, process.argv.slice(2));
```

and `"verify": "node scripts/verify.mjs"` in `package.json`, so the documented
entry point is `npm run verify -- <operation> …`. npm prints its own banner
lines on stdout, so an agent that parses the result line should run
`npm run -s verify -- <operation> …` (or `node scripts/verify.mjs`), and a
plug-in can put that spelling in `command` so the card shows it. A Python project can keep a
`python3 scripts/verify.py` wrapper that runs the Node wrapper with the same
arguments and returns its exit status.

## The plug-in

The full types are in [`src/types.ts`](src/types.ts). Two complete caller
examples are type-checked with the package:
[a Node application with fake controllers](examples/hub-like.mjs) and
[a Python application](examples/python-app.mjs). The test fixture
[`tests/fixture-app/plugin.mjs`](tests/fixture-app/plugin.mjs) is a third,
executed one.

| Field | What the adapter supplies |
| --- | --- |
| `app`, `repository`, `command`, `root` | Name used in run ids and unit names (lowercase, at most 16 characters); `owner/name`; the wrapper command printed in the card; the absolute checkout it serves |
| `scenarios`, `defaultScenario` | Named synthetic seeds. `seed({dataDir, scenario, …})` writes into an empty private directory before the application starts |
| `build` | `version`; the served `artifact` to hash: `{route}` read over loopback, `{file}` under `root`, or `{files: [...]}` hashed as `sha256sum <files> \| sha256sum` prints; an optional `prepare()` that builds before launch |
| `launch(ctx)` | `{argv, env?, cwd?}` for the application process. Bind `127.0.0.1:ctx.port` (0 on start). Launch Node through `ctx.node`. `env` is visible in `systemctl show`, so never put a credential there |
| `readiness` | `line(stdoutLine)` returns `{url}` for the ready line, which must name `http://127.0.0.1:<port>`; `probe(ctx)` is a loopback read of the app's own readiness route, reused as `doctor`'s health read |
| `components` | Actual and simulated parts, copied into the receipt |
| `checks` | Optional start-time boundary checks, such as "health reports simulator mode"; a failed check fails the start. `doctor: true` also re-runs a check in `doctor`; set it only for read-only checks |
| `captureSteps` | Named steps. `run(t)` drives `t.page` and records each expected observation with `await t.expect(name, fn)`. `t.screenshot(name)` and `t.attach(name, content)` add files to the capture. `scenario` and `fresh` control the starting state |
| `browser.modules` | Optional module names that export `chromium`, resolved from `root`. Default `playwright`, then `@playwright/test` |

What the core guarantees to every plug-in callback:

- `runtimeDir` is `<state root>/<run-id>/`, mode 0700, outside every Git
  checkout; `dataDir` is its `data/` subdirectory and is empty when `seed`
  runs. `TMPDIR` for the application is `<runtimeDir>/tmp`.
- The application runs as `app-verify-<run-id>.service` under the user
  manager with `KillMode=control-group`; its stdout and stderr go to
  `stdout.log` and `stderr.log` in `runtimeDir`, never into proof.
- `build.prepare` runs on `start` and `restart`, after the `starting`
  receipt and before the runtime directory and `seed`.
- A reseed (`scenario`, `handoff --reset`, a `fresh` step) stops the
  application, recreates `data/` and `tmp/`, truncates the two logs, calls
  `seed`, and relaunches with `ctx.port` set to the run's recorded port, so
  the run keeps its id, port and lease. It never runs `prepare`, and other
  files in `runtimeDir` stay. `stop` removes the whole `runtimeDir`.
- A capture step passes only when it recorded at least one assertion, every
  assertion passed, the page did not crash, the screenshot was written and
  the video was finalized. Anything else is `failed`, or `unavailable` when
  Playwright, Chromium or ffmpeg is missing. A capture is recorded as
  `failed` before it starts, so a killed capture never reads as passed.

### Writing capture steps

- Each step gets a new Chromium context at 1280×800 (or its `viewport`)
  with `reducedMotion: 'reduce'`, so animations settle and screenshots are
  stable. A step that checks animation turns motion back on first with
  `await t.page.emulateMedia({reducedMotion: 'no-preference'})`.
- Assert the settled state. Wait until every response the interaction caused
  has been applied, then compare exact values; a transient intermediate value
  can otherwise satisfy a wrong expectation. The fixture's first negative
  control caught exactly this.
- State persists between captures of one run. Either set `fresh: true` (the
  core reseeds `scenario`, or the current scenario, before the step and the
  capture log records it) or assert deltas, such as commands before and
  after.
- Name negative controls `control-*`. They are ordinary steps that report
  `failed` by design, and the adapter's tests assert that they fail. There is
  no expected-failure mode that turns a failure into a pass.
- Assert the simulated boundary inside the step, for example that reading a
  page sent no command to the fake controller.
- Attach evidence the page cannot show with `t.attach(name, content)`, for
  example an exact simulator frame and a label that says it is not physical
  evidence. Names are plain files (`[A-Za-z0-9][A-Za-z0-9._-]*`), never
  `after.png`, `interaction.webm`, `assertions.json` or an existing file, and
  at most 16 MB. They are listed in the capture record and log and frozen by
  `handoff`.

## Operations

`runCli(plugin, argv)` implements the contract's operations. Each prints one
JSON result line on stdout and progress, including the preview card, on
stderr, and returns the exit code: `0` when the outcome was verified, `1` for
a failed outcome, `2` for a usage error and `3` when the supervisor or browser
tooling is unavailable.

```text
help
start [--scenario <name>] [--lease <minutes>]
doctor [<run-id>]
scenario <run-id> <name>
capture <run-id> <step>
handoff <run-id> [--reset <scenario>]
extend <run-id> [--lease <minutes>]
stop <run-id>
restart <run-id>
```

The default lease is 120 minutes. `--lease` takes minutes, fractions allowed,
from 0.05 to 1440. Main result fields:

| Operation | Result |
| --- | --- |
| `start`, `restart` | `runId`, `state` (`running` or `failed`), `url`, `port`, `scenario`, `build`, `expiresAt`, `proofDir`, `card`; on failure `cause`, `detail`, `cleanup`. `restart` adds `restarts` and `continuity` (`same-candidate` or `different-candidate`) |
| `doctor` | `runs`: per run `state` (a receipt state or `stale`), `reasons`, `unit`, `leaseTimer`, `runtimeDir`, `preview` with `remainingMinutes`, `health`, `artifact` (`matches`, `changed`, `unread`), `checks` (those marked `doctor: true`), `failure`, `proof.sums` (`ok`, `tampered`, `not-frozen`), `windows` |
| `capture` | `n`, `step`, `set` (`verified` or `after-handoff`), `outcome`, `reason`, and absolute `screenshot`, `video`, `log`, `attachments`, `captureDir` |
| `handoff` | `frozenAt`, `verified` directory, `url`, `expiresAt`, `card` |
| `scenario`, `extend`, `stop` | The new scenario and port, the new expiry and timer, or the final state and `cleanup` |

An error that stops an operation before it acts prints
`{"operation", "error", "detail"}`, for example `run-not-running`.

## Capture without a supervisor

`runCaptureStep(plugin, step, {url, outputDir, scenario?, dataDir?,
runtimeDir?, runId?})` drives one step against an application the caller
already started and judges it exactly as `capture` does, writing `after.png`,
`interaction.webm` and `assertions.json` into a new or empty `outputDir`. It
needs no user manager, receipt or lease, so an adapter's CI can prove on any
Linux runner that its reference step passes and its `control-*` steps fail.
It throws for an unknown step, a URL other than `http://127.0.0.1:<port>/` or
a non-empty output directory.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `APP_VERIFY_STATE_ROOT` | `~/.local/state/app-verify` | Runtime root. Must be outside every Git checkout |
| `APP_VERIFY_PROOF_ROOT` | `<canonical checkout>/.local/evidence/verify` | Proof root. The canonical checkout is the repository's main worktree, never a linked worktree's path. A proof root inside a checkout must be ignored by Git |
| `APP_VERIFY_WINDOWS_CHECK` | on when WSL interop and `curl.exe` exist | `off` skips the Windows reachability read |

The overrides exist for tests; normal runs use the defaults.

## Tests

`npm run test:app-verify` runs the suite against real transient units, a
fixture counter application and the repository's Chromium, in about a
minute. While it runs, units named `app-verify-avt-<6 hex>-*` exist; each
test stops the units of its own app name when it ends and fails if any
remain. Test leases are at most ten minutes, so even a killed test run
leaves nothing past that. Lifecycle and capture tests skip with a printed reason when no user
manager exists, and fail instead when `APP_VERIFY_REQUIRE_SYSTEMD=1`, as the
Hub's CI job sets. `tests/unsupervised.test.mjs` needs only Chromium and
always runs. `npm run test:app-verify:package` packs the archive and runs the
packaged suite from an isolated consumer.

## Future work

Hub [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495)
composes one preview from three runs, one per application, and needs the Hub
run's scenario to point at the other runs' loopback URLs. The planned
additive shape is `start --input <name>=<value>` for non-secret inputs, a
`ctx.inputs` map on `seed` and `launch`, an optional `receipt.inputs` and
`restart` reusing them. One unit per run stays. Readers already ignore
unknown receipt fields, so this can ship in a 1.x minor version.
