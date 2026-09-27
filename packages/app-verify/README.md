# @jimmie-potts/app-verify

The shared lifecycle core for disposable app verification runs. It implements
the operations, receipt, storage roots, supervisor, lease, doctor, frozen
proof, capture harness and preview card of the Hub's
[app verification contract](../../docs/app-verification.md) once, with no
knowledge of any application. An adapter supplies one plug-in object and a
two-line wrapper. [ADR 0009](../../docs/decisions/0009-app-verification-runs.md)
records the decisions.

Callers: the Hub adapter
([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494)), the
Nanoleaf wall ([codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193))
and Pixoo ([divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118)).

Requirements: Linux with a `systemd --user` manager (`systemctl --user
is-system-running` answers `running` or `degraded`), Node.js 22 or later, and,
for `capture`, Playwright 1.50 or later with its Chromium and ffmpeg installed
by the consumer (`npx playwright install chromium`). Playwright is an optional
peer dependency; the core never bundles a copy. The package has no runtime
dependencies.

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
entry point is `npm run verify -- <operation> …`. A Python project can keep a
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
| `app`, `repository`, `command`, `root` | Name used in run ids and unit names; `owner/name`; the wrapper command printed in the card; the checkout it serves |
| `scenarios`, `defaultScenario` | Named synthetic seeds. `seed({dataDir, scenario, …})` writes into an empty private directory before the application starts |
| `build` | `version`, the served `artifact` to hash (`{route}` read over loopback or `{file}` under `root`), and an optional `prepare()` that builds before launch |
| `launch(ctx)` | `{argv, env?, cwd?}` for the application process. Bind `127.0.0.1:ctx.port` (0 on start). Launch Node through `ctx.node`. `env` is visible in `systemctl show`, so never put a credential there |
| `readiness` | `line(stdoutLine)` returns `{url}` for the ready line; `probe(ctx)` is a loopback read of the app's own readiness route, reused as `doctor`'s health read |
| `components` | Actual and simulated parts, copied into the receipt |
| `checks` | Optional start-time boundary checks, such as "health reports simulator mode"; a failed check fails the start |
| `captureSteps` | Named steps. `run(t)` drives `t.page` and records each expected observation with `await t.expect(name, fn)` |
| `browser.modules` | Optional module names that export `chromium`, resolved from `root`. Default `playwright`, then `@playwright/test` |

What the core guarantees to every plug-in callback:

- `runtimeDir` is `<state root>/<run-id>/`, mode 0700, outside every Git
  checkout; `dataDir` is its `data/` subdirectory and is empty when `seed`
  runs. `TMPDIR` for the application is `<runtimeDir>/tmp`.
- The application runs as `app-verify-<run-id>.service` under the user
  manager with `KillMode=control-group`; its stdout and stderr go to
  `stdout.log` and `stderr.log` in `runtimeDir`, never into proof.
- A reseed (`scenario`, `handoff --reset`) stops the application, empties
  `dataDir`, calls `seed`, and relaunches with `ctx.port` set to the run's
  recorded port, so the run keeps its id, port and lease.
- A capture step passes only when it recorded at least one assertion, every
  assertion passed, the page did not crash, the screenshot was written and
  the video was finalized. Anything else is `failed`, or `unavailable` when
  Playwright, Chromium or ffmpeg is missing.

## Operations

`runCli(plugin, argv)` implements the contract's operations. Each prints one
JSON result line on stdout and progress on stderr, and returns the exit code:
`0` when the outcome was verified, `1` for a failed outcome, `2` for a usage
error and `3` when the supervisor or browser tooling is unavailable.

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
up to 1440.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `APP_VERIFY_STATE_ROOT` | `~/.local/state/app-verify` | Runtime root. Must be outside every Git checkout |
| `APP_VERIFY_PROOF_ROOT` | `<canonical checkout>/.local/evidence/verify` | Proof root. The canonical checkout is the repository's main worktree, never a linked worktree's path |
| `APP_VERIFY_WINDOWS_CHECK` | on when WSL interop and `curl.exe` exist | `off` skips `doctor`'s Windows reachability read |

The overrides exist for tests; normal runs use the defaults.
