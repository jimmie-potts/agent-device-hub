# Verification checks

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

## App verification and preview runs

[App verification](../../docs/app-verification.md) defines the operations, receipt,
storage, supervisor and failure behavior for disposable application runs with
synthetic data, and [ADR 0009](../../docs/decisions/0009-app-verification-runs.md) records
the decisions. Runs use transient `systemd --user` units, keep runtime state
under `~/.local/state/app-verify/` and proof under the canonical checkout's
`.local/evidence/verify/`, and never use the installed ports or services.

Hub #494 implements the lifecycle once in the private workspace package
[`packages/app-verify`](README.md)
(`@jimmie-potts/app-verify`), which the Hub, Nanoleaf and Pixoo adapters
consume through one plug-in each. Use Node 24 from the worktree root and run
`npm run build`, `npm run typecheck` (which also type-checks the package's
caller examples), `npm run test:app-verify` and `npm run test:app-verify:package`.
The `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts set
`APP_VERIFY_SINGLE_RUN=1`, so a second `start` beside a live run is refused
([one run at a time](../../docs/app-verification.md#one-run-at-a-time)); the test suites
do not set it.
`npm run -s verify -- prerequisites` is the Hub's read-only local inspection;
it never qualifies launch, capture or Windows browser handoff. Pinned Nanoleaf
and Pixoo adapters remain on core 1.1.0 and report the operation unsupported.
Set `TMPDIR` outside every Git checkout, for example
`~/.cache/agent-device-hub/<task>-tmp`: the tests' runtime roots live under
it, and the core refuses runtime state inside a checkout.

The suite has two parts:

- **Everywhere, including CI:** receipt validation, `help`, `start` refusing
  without a user manager (exit 3, nothing created; forced locally by hiding
  the user bus), `tests/lock.test.mjs` (concurrent receipt updates against a
  lock left by a killed writer lose nothing, and a stuck or holder-less lock
  breaker ends in `receipt-locked` or is cleared), and
  `tests/unsupervised.test.mjs`. That file judges capture
  steps through `runCaptureStep`: the reference passes, and a `control-*`
  wrong expectation, predicates that return `false`, a known-broken app and a
  step without assertions fail. Missing Playwright, Chromium or ffmpeg is
  `unavailable`, and an encoder that writes nothing or a truncated WebM is
  `failed`, as is a step whose served artifact changed before or during it.
  The lock file also forces a prepared lock directory swept
  mid-acquire and a stale dead-breaker record, and `tests/inputs.test.mjs`
  runs its input refusals and `runCaptureStep` inputs test here.
  `tests/error-body.test.mjs` checks the shared error body on each refusal
  that needs no run, and checks every body against
  `@jimmie-potts/event-contracts`' `errorBody` (Hub #921).
  `tests/single-run.test.mjs` checks the one-run guard's refusal wording
  against the README's example, and that a guarded `start` without a user
  manager still exits 3 (Hub #944).
- **Only on a host with a user manager** (`systemctl --user
  is-system-running` answering `running`, `degraded`, `starting` or
  `initializing`): every lifecycle test. These start real transient units
  named `app-verify-avt-*` with leases of seconds and a fixture counter
  application, and stop every unit they created. They cover start order,
  failed and interrupted starts, concurrency and reseeds, extend (including a
  refused timer and a stray one), expiry, doctor staleness, restart, frozen
  proof, attachments, interrupted captures, receipt-less stop and a stop
  retried after `receipt-locked`, and, for 1.1, inputs kept across every
  relaunch, scenario-specific inputs, redacted failure details and extra
  endpoints (`tests/endpoints.test.mjs`), and the one-run guard: a second
  `start` with `APP_VERIFY_SINGLE_RUN=1` is refused beside a live run of any
  app and leaves that run untouched, two starts begun together cannot both
  pass, a held claim refuses a start, and failed units, stray timers and the
  host route's command unit never block it. Without a
  manager they skip, each with the printed reason, unless
  `APP_VERIFY_REQUIRE_SYSTEMD=1` makes that a failure. The delivery evidence
  records them from the owner's WSL host.

The package check installs the packed archive into an isolated consumer under
`TMPDIR`, outside every checkout, that supplies its own Playwright. It verifies
every file hash, checks that no other `@jimmie-potts` package resolves there,
runs the packaged suite and repeats any skip reason. The error body's registry
check prints its skip reason there. Neither check touches installed services,
personal state or devices, and neither contacts Windows: the tests set
`APP_VERIFY_WINDOWS_CHECK=off`.

The App verification CI job runs both after a fresh build and Chromium
install. Depot's Ubuntu runner, which ran CI until #870, was not booted with
systemd: on PR #552, `systemctl --user is-system-running` answered `offline` and
`loginctl enable-linger` failed with "System has not been booted with systemd
as init system (PID 1)". GitHub-hosted runners do have a user manager, but under
their systemd 255 the lease timer does not read back
([run](https://github.com/jimmie-potts/agent-device-hub/actions/runs/37464802851), [#873](https://github.com/jimmie-potts/agent-device-hub/issues/873)).
The App verification job therefore hides the user bus, the lifecycle tests skip,
and CI proves the first part only.
`npm run package:app-verify` writes
`artifacts/jimmie-potts-app-verify-<version>.tgz` and its `.sha256` for a
release; other repositories vendor that archive.

For legacy Hub adapter and composition checks, see
[the Hub verification testing guide](../../apps/hub/verify/TESTING.md).

### Host routing checks

Run `npm run test:verify-host` with Node 24 from the Hub worktree. CI runs this
in the App verification job. It checks explicit selection, named adapter and
checkout identity, literal arguments, minimal environment, denied supervisor,
command-only cleanup, timeout/abort, preserved nonzero adapter results, and
unknown outcomes without a start retry. The transport test starts only a
disposable Node subprocess; supervisor fixtures start no systemd units.
These source checks do not qualify the named host or Windows browser. Keep
shared build/type, controller-contract and workflow checks for this source
change; unchanged app lifecycle/consumer behavior keeps its existing CI checks.

