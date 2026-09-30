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
  `systemctl --user is-system-running`, not its exit status: `running`,
  `degraded`, `starting` and `initializing` are usable. The lease always runs
  `systemctl` from `/usr/bin` or `/bin`.
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
gh release download app-verify-v1.1.0 --repo jimmie-potts/agent-device-hub \
  --pattern 'jimmie-potts-app-verify-1.1.0.tgz*' --dir vendor
(cd vendor && sha256sum -c jimmie-potts-app-verify-1.1.0.tgz.sha256)
npm install --save-dev file:vendor/jimmie-potts-app-verify-1.1.0.tgz
```

Version 1.1 only adds to 1.0: a 1.0 plug-in runs unchanged, and receipts stay
`app-verification/1`. See [What 1.1 adds](#what-11-adds).

The workspace source is now 1.3.0, with a read-only `prerequisites` diagnostic
and optional frozen-proof HTTP delivery.
The release example above remains the published 1.1 adoption path; this source
change does not publish a 1.3 release or update another repository's pin.

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
| `scenarios`, `defaultScenario` | Named synthetic seeds. `seed({dataDir, scenario, …})` writes into an empty private directory before the application starts. Optional `requiredInputs` (1.1) names declared inputs the scenario cannot run without |
| `build` | `version`; the served `artifact` to hash: `{route}` read over loopback, `{file}` under `root`, or `{files: [...]}` hashed as `sha256sum <files> \| sha256sum` prints; an optional `prepare()` that builds before launch |
| `launch(ctx)` | `{argv, env?, cwd?}` for the application process. Bind `127.0.0.1:ctx.port` (0 on start). Launch Node through `ctx.node`. `env` is visible in `systemctl show`, so never put a credential there. It overrides the core's `PATH`, `TMPDIR` and private `HOME` |
| `readiness` | `line(stdoutLine)` returns `{url, endpoints?}` for the ready line: `url` must name `http://127.0.0.1:<port>` and, since 1.1, carry no credentials, query or fragment (a path is allowed); optional `endpoints` names other loopback listeners of the app, each exactly `http://127.0.0.1:<port>/` (1.1); `probe(ctx)` is a loopback read of the app's own readiness route, reused as `doctor`'s health read; optional `failureCause(stderrTail)` returns the app's own stable cause line for a failed start |
| `inputs` | Optional (1.1): `{name: {description, required?}}`, the non-secret run inputs a caller may give with `--input <name>=<value>` |
| `reservedPorts` | Optional ports a run must never serve on, added to the installed services' ports |
| `components` | Actual and simulated parts, copied into the receipt |
| `checks` | Optional start-time boundary checks, such as "health reports simulator mode"; a failed check fails the start. `doctor: true` also re-runs a check in `doctor`; set it only for read-only checks |
| `captureSteps` | Named steps. `run(t)` drives `t.page` and records each expected observation with `await t.expect(name, fn)`. `t.screenshot(name)` and `t.attach(name, content)` add files to the capture. `scenario` and `fresh` control the starting state |
| `browser.modules` | Optional module names that export `chromium`, resolved from `root`. Default `playwright`, then `@playwright/test` |
| `prerequisites.inspect()` | Optional (1.3), trusted read-only local checks such as build freshness. Return stable check ids, phase (`launch`, `capture`, `handoff`), status (`present`, `missing`, `unknown`, `unsupported`) and fixed non-secret reason/next text. Missing checks require an actionable next step. Core IDs are reserved except the delegated `app-build` slot. Shape validation does not sanitize secrets. The hook must not build, launch, write or probe the app. An absent hook reports `app-build: unsupported` |

What the core guarantees to every plug-in callback:

- `runtimeDir` is `<state root>/<run-id>/`, mode 0700, outside every Git
  checkout; `dataDir` is its `data/` subdirectory and is empty when `seed`
  runs. The application's `TMPDIR` is `<runtimeDir>/tmp` and its `HOME` is
  `<runtimeDir>/home`, so it never reads the caller's personal files. A
  plug-in that genuinely needs the real home, for example for a Python user
  site, sets `env: {HOME: process.env.HOME}` and owns that choice: `start`
  names each overridden variable (never its value) in the `unit-started`
  event and a progress line, and `stop` removes only the runtime directory,
  so an overridden `HOME` or `TMPDIR` is the plug-in's to clean.
- A ready line that announces an installed service's port (8788, 8765, 8787,
  8791, 41230, 41231) or one of `reservedPorts`, as its URL or as an extra
  endpoint, fails the start with `port-reserved`.
- When a start or reseed fails, the core passes the last 4 KB of the app's
  stderr, in memory only, to `readiness.failureCause`. It records the
  returned line in `failure.detail` only if that line is printable ASCII of at
  most 200 characters (no control, bidi or zero-width characters); a throw is
  ignored. Match only stable,
  non-secret cause lines, such as `/^hub-start-failed: [a-z0-9-]+$/m`, and
  never return the tail itself.
- Since 1.1, every `failure.detail`, check `reason` (including `doctor`'s
  health and check reasons) and capture `reason` the core records or prints,
  and each assertion error and note in a supervised capture's
  `assertions.json`, has each absolute path outside the run's two roots
  replaced with `<path>` and is capped at 1000 characters. An error such as a
  child process's `Command failed: /abs/…` therefore cannot put a private
  path into a receipt, event, printed line or frozen log. A path is judged
  after normalizing `..`; a `file://` URL's path counts as a path. Full
  `http(s)` URLs, relative paths and paths inside the roots are kept. A bare
  route such as `/api/x` cannot be told from a file path and is replaced, so
  name routes by their full URL in reasons, as the core does for its own
  artifact route.
- The application runs as `app-verify-<run-id>.service` under the user
  manager with `KillMode=control-group`; its stdout and stderr go to
  `stdout.log` and `stderr.log` in `runtimeDir`, never into proof.
- `build.prepare` runs on `start` and `restart`, after the `starting`
  receipt and before the runtime directory and `seed`.
- A reseed (`scenario`, `handoff --reset`, a `fresh` step) stops the
  application, recreates `data/`, `tmp/` and `home/`, truncates the two logs,
  calls `seed`, and relaunches with `ctx.port` set to the run's recorded port, so
  the run keeps its id, port and lease. It never runs `prepare`, and other
  files in `runtimeDir` stay. `stop` removes the whole `runtimeDir`. A
  relaunch passes the run's inputs again and each recorded endpoint's port as
  `ctx.endpointPorts`.
- A capture step passes only when it recorded at least one assertion, every
  assertion passed, the page did not crash, the screenshot was written and
  the video was finalized (a known-size WebM Segment that ends the file, with
  Cues; a failed context close never counts). Since 1.1 the served artifact
  must also still match the run's `build.artifactDigest` before and after
  the step: another run's rebuild in the same checkout can change what this
  run serves. Anything else is `failed`, or `unavailable` when
  Playwright, Chromium or ffmpeg is missing. A capture is recorded as
  `failed` before it starts, so a killed capture never reads as passed.

### Writing capture steps

- Each step gets a new Chromium context at 1280×800 (or its `viewport`)
  with `reducedMotion: 'reduce'`, so animations settle and screenshots are
  stable. A step that checks animation turns motion back on first with
  `await t.page.emulateMedia({reducedMotion: 'no-preference'})`.
- `t.expect(name, check)` fails when `check` throws, rejects or returns
  `false`, so Playwright predicates work directly:
  `await t.expect('the card is shown', () => t.page.getByText('Done').isVisible())`.
  Any other return value passes.
- Assert the settled state. Wait until every response the interaction caused
  has been applied, then compare exact values; a transient intermediate value
  can otherwise satisfy a wrong expectation. The fixture's first negative
  control caught exactly this.
- State persists between captures of one run. Either set `fresh: true` (the
  core reseeds `scenario`, or the current scenario, before the step and the
  capture log records it) or assert deltas, such as commands before and
  after. Delta assertions, like the fixture's `read-only` and `command-once`,
  assume one capture at a time per run: a concurrent capture's commands land
  in the same application.
- Name negative controls `control-*`. They are ordinary steps that report
  `failed` by design, and the adapter's tests assert that they fail. There is
  no expected-failure mode that turns a failure into a pass. A run cited as a
  change's delivery proof runs its controls in tests (`runCaptureStep`) or
  after handoff, so its verified set holds only passed captures: the delivery
  preflight (#496) rejects a verified set with any capture that did not pass.
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
stderr, and returns the exit code: `0` when an operation completed (not runtime
qualification for `prerequisites`), `1` for a failed outcome, `2` for a usage
error and `3` when required local tooling or a prerequisite is missing.

```text
help
prerequisites
start [--scenario <name>] [--lease <minutes>] [--input <name>=<value>]...
doctor [<run-id>]
scenario <run-id> <name> [--input <name>=<value>]...
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
| `help` | `app`, `command`, `coreVersion`, `operations` (with `[--input <name>=<value>]...` on `start` and `scenario` only when the plug-in declares inputs), `inputs` (each with `description` and `required`), `scenarioInputs` (each scenario's `requiredInputs`), `scenarios`, `defaultScenario`, `steps`, `exitCodes` |
| `prerequisites` (1.3) | `scope: local-read-only`, individual `checks`, and separate `launch`, `capture`, `handoff` phase summaries. Each phase's operation stays `unproven`: no unit, socket, browser, video or Windows handoff is attempted. A missing observed requirement exits 3; unknown and unsupported checks do not turn into a ready claim. Use `prerequisitesSupport(help)` to distinguish an older adapter's absent operation from malformed help |
| `start`, `restart` | `runId`, `state` (`running` or `failed`), `url`, `port`, `inputs` (when the plug-in declares any), `endpoints` (when the ready line names any), `scenario`, `build`, `expiresAt`, `proofDir`, `card`; on failure `cause`, `detail`, `cleanup`. `restart` adds `restarts` and `continuity` (`same-candidate` or `different-candidate`) |
| `stop` of a run with an unreadable receipt | `state: stale`, `receipt: unreadable` and `cleanup` by unit names; the file is left as found |
| `stop` of a run whose handoff was interrupted | Units, timers and the runtime directory go first. Then `proof` reports `committed` (a complete own set), `unwound` (captures returned) or `conflict` (files left for inspection). A `receipt-locked` refusal still reports the `cleanup` already done |
| `stop` retried after `receipt-locked` | Records the cleanup and state of the refused attempt: an item it removed counts as `removed`, not a missing runtime directory's `partial` |
| `handoff` after an interrupted one | Finishes the freeze. It rebuilds from `verified.partial/`, or commits an uncommitted `verified/` only when its digest and time match this run's `frozen` event and its copy matches the live receipt. It rebuilds if a later capture exists, and otherwise refuses with `proof-conflict`, changing nothing |
| `doctor` | `runs`: per run `state` (a receipt state or `stale`), `reasons`, `unit`, `leaseTimer`, `runtimeDir`, `inputs` (when recorded), `preview` with `remainingMinutes`, `health`, `artifact` (`matches`, `changed`, `unread`), `listener` (the unit's listening ports against the recorded one and, under `endpoints`, each recorded endpoint's port; any missing one is `listener-mismatch`), `checks` (those marked `doctor: true`), `failure`, `proof.sums` (`ok`, `tampered`, `missing`, `partial` for an interrupted handoff that a rerun finishes, `conflict` for an uncommitted set a rerun would refuse, `unreadable`, `not-frozen`); `reasons` include `extra-lease-timer` when another armed lease could end the run early, `windows` |
| `capture` | `n`, `step`, `set` (`verified` or `after-handoff`), `outcome`, `reason`, and absolute `screenshot`, `video`, `log`, `attachments`, `captureDir` |
| `handoff` | `frozenAt`, `verified` directory, `url`, `expiresAt`, `card`; opt-in `proofUrls` (1.2) |
| `scenario`, `extend`, `stop` | The new scenario, port, `inputs` and `endpoints`; the new expiry and timer; or the final state and `cleanup` |

An error that stops an operation before it acts prints
`{"operation", "error", "detail"}`, for example `run-not-running`, or
`receipt-locked` when another live operation holds the run's receipt for
more than 10 s. The lock is created atomically with its holder's PID, start
time and a nonce. A lock left by a killed operation breaks at once, one
breaker at a time, so a live lock is never displaced. A dead lock or dead
breaker is renamed to a name derived from its holder record, so an operation
that read the same record late moves nothing. That
`.receipt.lock.dead-<hash>/` directory stays until an update at least a minute
later sweeps it; one left by a run's last operation stays in the proof
directory, outside `verified/`, where nothing reads it. An operation suspended
for over a minute while acquiring the lock, whose prepared directory another
operation's sweep removed, prepares a new one and restarts its 10 s wait,
because a suspension is not a wait on a holder. The receipt is written only while the lock still names
the writer, so a race can refuse an update but never lose one silently.

## Capture without a supervisor

`runCaptureStep(plugin, step, {url, outputDir, scenario?, dataDir?,
runtimeDir?, runId?, inputs?, endpoints?, artifactDigest?})` drives one step against an application the caller
already started and judges it exactly as `capture` does, writing `after.png`,
`interaction.webm` and `assertions.json` into a new or empty `outputDir`. It
needs no user manager, receipt or lease, so an adapter's CI can prove on any
Linux runner that its reference step passes and its `control-*` steps fail.
The starting state is the caller's job: it never reseeds, so give a `fresh`
step a newly seeded application, and pass the `scenario` it was seeded with.
Pass the `inputs` the application was started with; they are checked as
`start` checks them. With the `artifactDigest` recorded at start, the served
artifact is re-read before and after the step, as `capture` does. It throws for an unknown step, a step pinned to another
scenario, a URL or endpoint other than `http://127.0.0.1:<port>/`, a bad or
missing input or a non-empty output directory.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `APP_VERIFY_STATE_ROOT` | `~/.local/state/app-verify` | Runtime root. Must be outside every Git checkout |
| `APP_VERIFY_PROOF_ROOT` | `<canonical checkout>/.local/evidence/verify` | Proof root. The canonical checkout is the repository's main worktree, never a linked worktree's path. A proof root inside a checkout must be ignored by Git |
| `APP_VERIFY_WINDOWS_CHECK` | on when WSL interop and `curl.exe` exist | `off` skips the Windows reachability read |

The overrides exist for tests; normal runs use the defaults.

## Tests

`npm run test:app-verify` runs the suite in about a minute. Set `TMPDIR`
outside every Git checkout (for example `~/.cache/agent-device-hub/<task>-tmp`):
the tests' runtime roots live under it, and the core refuses runtime state
inside a checkout.

- `tests/unsupervised.test.mjs`, `tests/lock.test.mjs`, the receipt tests,
  `help`, the no-manager `start` refusal and the usage and `runCaptureStep`
  tests in `tests/inputs.test.mjs` need no user manager and always run,
  including in the Hub's CI. They cover:
  - the reference and `control-*` steps, and `false` predicates;
  - a broken app and a silent step;
  - missing Playwright, Chromium and ffmpeg;
  - an encoder that writes nothing, and a truncated WebM;
  - lock races: a dead lock under contention, a stuck or holder-less breaker,
    a prepared lock directory swept mid-acquire and a stale dead-breaker record;
  - undeclared, secret-like, missing, duplicate and non-ASCII inputs, and
    inputs given to `runCaptureStep`;
  - a served artifact that changed before or during a step.
- Every other test drives real transient units named `app-verify-avt-<6 hex>-*`
  with a fixture counter application. While the suite runs, those units exist.
  Each test stops the units of its own app name when it ends and fails if any
  remain. Test leases are at most ten minutes, so even a killed run leaves
  nothing past that.
  These tests skip, each with the reason, when no user manager exists, and
  fail instead when `APP_VERIFY_REQUIRE_SYSTEMD=1`. Depot's Ubuntu runner is
  not booted with systemd, so they run on a systemd host such as the owner's
  WSL PC.

`npm run test:app-verify:package` packs the archive and runs the packaged
suite from an isolated consumer.

## What 1.2 adds

An adapter may set `servesProof: true` when its launcher mounts
`createProofHandler({proofDir, runId})` on the preview's existing HTTP listener.
The helper returns `{prefix, handle}`; dispatch raw request targets starting
with `prefix` to `handle(request, response)` within the app's normal request
admission and close path. `launch(context)` receives the core's resolved
`proofDir` in addition to its existing fields. Pass that path and `runId` to
the child through its private data directory. The helper owns no server or
lease and must not be mounted on an installed service.

After handoff, `proofUrls` contains `{capture, step, path, url}` for each passed
frozen capture's screenshot, video, assertion log and attachment. `path` is
relative to the run's proof directory; the card prints a `Proof` line for each
URL. `proofLinks(receipt)` builds the same list. Adapters without `servesProof`
keep their existing output. The receipt remains `app-verification/1`.

The Linux helper serves only committed files under
`/__app-verify/proof/<run-id>/capture-<n>/<filename>`. It checks the frozen
event's manifest digest, frozen receipt and requested bytes, and refuses links,
unrelated paths, later captures, failed captures and expired receipts. GET and
HEAD support a single byte range. Host must be the bound `127.0.0.1:<port>`;
Origin, when supplied, must match. Cross-site document navigation is allowed
for owner links, while cross-site subresources are refused. PNG/JPEG/WebM/MP4
display inline; other types download with script execution disabled. Reads
never change proof. At most two reads run concurrently; metadata is bounded to
16 MiB and each artifact to 128 MiB. Oversized or invalid proof returns 404,
and capacity returns 503. Retained local files remain available after stop.

## What 1.1 adds

Delivered for Hub [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495),
which composes one preview from three runs, one per application. One unit per
run stays, and a 1.0 plug-in, receipt and caller work unchanged.

- **Run inputs.** A plug-in declares `inputs: {name: {description,
  required?}}`, and callers give values with `start --input <name>=<value>`
  (repeatable), for example another run's loopback URL.
  - `scenario <run-id> <name> --input …` replaces the named values and keeps
    the others. A reseed without `--input`, a `fresh` step, `handoff --reset`
    and `restart` reuse the recorded values.
  - `seed`, `launch`, `readiness.probe`, boundary checks and capture steps
    get them as `ctx.inputs`.
  - These are usage errors (exit 2), refused before any run changes: an
    undeclared name, a missing required input, a name given twice, a value
    that is not 1 to 512 printable ASCII characters, and a name matching
    `/token|secret|password|credential|key/i`. Inputs are recorded in the
    receipt, events and frozen copy, so they never carry a credential, and a
    plug-in that declares a secret-like name is refused outright.
  - A scenario may list `requiredInputs`: declared inputs it cannot run
    without, even when they are optional for the plug-in. Seeding it without
    them is a usage error on `start`, `scenario`, a `fresh` step,
    `handoff --reset` and `restart`, raised before anything stops.
  - `receipt.inputs` is written whenever the plug-in declares inputs (`{}`
    when none was given). The `seeded`, `unit-started` and `reseeded` events
    carry them. `help` lists the declared inputs, `scenarioInputs` (each
    scenario's required inputs) and `coreVersion`, and shows `--input` on
    `start` and `scenario` only for a plug-in that declares inputs.
  - A fresh step, `handoff --reset` and `restart` take no `--input`: they
    reuse the recorded values. When one is missing they say to reseed with
    `scenario <run-id> <name> --input …` or to start a new run.
  - A credential, or a path to one, never travels as an input. A caller that
    must supply one writes it with mode 0600 into the run's runtime directory
    (`<runtime root>/<run-id>/`, the receipt's `roots.runtime` and
    `owned.runtimeDir`), outside `data/`, `tmp/` and `home/` so that a reseed
    keeps it. The plug-in reads it by a fixed file name from `ctx.runtimeDir`.
    `start` creates that directory, so write the file after `start` and before
    the reseed (`scenario`) that needs it; `stop` deletes it with the
    directory. A scenario that reads such a file therefore cannot be a run's
    first seed, and `restart` of a run in that scenario stops it and then
    fails at seed, because the new run's directory does not exist yet. Stop
    it instead, start a new run in a scenario that needs no file, write the
    file and reseed.
- **Extra endpoints.** A ready line may return `endpoints: {name: url}` for
  other loopback listeners of the same application, such as a fake controller
  another run must reach. It names at most 16; each name is a letter followed
  by up to 63 letters, digits, `_` or `-`, and each URL is exactly
  `http://127.0.0.1:<port>/`, with no path, credentials, query or fragment,
  because it is recorded and printed. The main `url` now refuses credentials,
  a query or a fragment too.
  - They are recorded as `receipt.owned.endpoints`, returned by `start`,
    printed in the card as `Endpoint  <name> <url>` and given to probes,
    checks and steps as `ctx.endpoints`.
  - An endpoint on an installed or reserved port fails the start with
    `port-reserved`.
  - A relaunch gets their ports as `ctx.endpointPorts` and must announce each
    recorded endpoint on the same port; otherwise the reseed fails with
    `port-changed`.
  - `doctor` checks each endpoint's port against the unit's listeners, as it
    does the main port.
- **Served artifact re-check.** `capture` re-reads the served artifact before
  and after the step and fails it, with `the served artifact changed since
  start (recorded …, served …)`, when the digest differs from
  `build.artifactDigest`. The page is not driven when it already differs.
  `runCaptureStep` does the same when given `artifactDigest`.
- **Redacted details.** A recorded or printed `failure.detail`, check
  `reason` (also in `doctor`) or capture `reason`, and a supervised capture
  log's assertion errors and notes, keep paths inside the two roots and full
  URLs, replace every other absolute path with `<path>` and are capped at 1000
  characters.
- **Lock and stop follow-ups from 1.0's review.** A retried `stop` records
  the refused attempt's cleanup (P-S21); a swept prepared lock directory is
  retried (S25); a stale dead-breaker record cannot displace a live breaker
  (S26).

The contexts a plug-in receives gained fields the core always supplies:
`inputs` everywhere, `endpointPorts` on `launch` and `endpoints` on probes,
checks and steps. Code that builds a context itself, such as a test calling
`seed({runId, root, runtimeDir, dataDir, scenario})`, still runs, but
type-checked code must add `inputs: {}` (and the endpoint map) to it.
