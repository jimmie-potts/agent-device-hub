# App verification interface

Start here to select an adapter, exercise a disposable candidate, retain proof
and clean up. The shared package owns the [operation/receipt contract](../packages/app-verify/OPERATIONS.md)
and [plug-in API](../packages/app-verify/README.md#the-plug-in). Current B.U.N.N.Y.
uses the [runtime adapter](../apps/runtime/verify/README.md); the retained legacy
Hub and cross-repository composition have separate adapters.

Hub [#493](https://github.com/jimmie-potts/agent-device-hub/issues/493) defines
one small way for a delivery agent or the owner to start a disposable copy of an
application with synthetic data and simulated device transports, establish what
is running, exercise a scenario, keep proof, and hand over a preview that
expires. Hub is the first caller
([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494)); the
Nanoleaf wall ([codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193))
and Pixoo ([divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118))
adapters implement the same operations for their applications, as do the CHOMPI bridge
([#853](https://github.com/jimmie-potts/agent-device-hub/issues/853),
[`apps/chompi-bridge/verify`](../apps/chompi-bridge/verify/README.md), `npm run -s verify:chompi --`)
and the new runtime ([#920](https://github.com/jimmie-potts/agent-device-hub/issues/920),
[`apps/runtime/verify`](../apps/runtime/verify/README.md), `npm run -s verify:runtime --`).
[ADR 0009](decisions/0009-app-verification-runs.md) records the lasting
decisions and their alternatives. The initiative and its accepted scope are in
[#488](https://github.com/jimmie-potts/agent-device-hub/issues/488).

The lifecycle below is implemented once, app-agnostic, in the Hub package
[`@jimmie-potts/app-verify`](../packages/app-verify/README.md) (owner decision,
2026-09-27). Each adapter supplies only an application plug-in (build identity,
scenarios, launch, readiness, components, capture steps and boundary checks)
and its wrapper command; the package's tests prove the shared behavior against
real transient units once.

This document is a contract for source work. Nothing here is installed. A run
never attaches to the installed services, personal state or physical devices.
Actual Windows-host qualification belongs to
[#497](https://github.com/jimmie-potts/agent-device-hub/issues/497).

## Vocabulary

- **Run**: one disposable application instance with its own identity, state,
  port, supervisor unit and lease. `run-id` is
  `<app>-<UTC start, yyyymmddThhmmssZ>-<6 hex>`, for example
  `hub-20260927T060259Z-3f9a1c`.
- **Adapter**: the application's project-owned plug-in for the shared core and
  the command that runs it. Each project chooses its wrapper (`npm run verify --`,
  `python3 scripts/verify.py`); the operation names and receipt are shared.
- **Candidate**: the source revision and built artifact a run serves. A run
  always names its candidate, including when it is dirty or unknown.
- **Scenario**: a named, deterministic synthetic seed owned by the adapter's
  test fixtures. Its version is the candidate's source revision, because the
  fixtures live with the source.
- **Proof**: screenshots, video, receipts and check output for a run. The
  captures taken before handoff are the **verified set**; handoff freezes that
  set and it never changes again. Later captures and the live receipt sit
  beside it, outside the frozen set.
- **Preview**: the same run, or a reset copy of its state, left serving for a
  human to explore under a lease.
- **Lease**: the time after which the supervisor stops the run by itself.
  Default two hours; explicit `extend` and `stop`.
- **Owned resources**: the exact unit names, runtime directory, listener port
  and proof directory a run created. Cleanup touches only these.

## Operations

See [Operations](../packages/app-verify/OPERATIONS.md#operations) for the authoritative procedure.

### One run at a time

See [One run at a time](../packages/app-verify/OPERATIONS.md#one-run-at-a-time) for the authoritative procedure.

### Readiness and build identity

See [Readiness and build identity](../packages/app-verify/OPERATIONS.md#readiness-and-build-identity) for the authoritative procedure.

### Receipt

See [Receipt](../packages/app-verify/OPERATIONS.md#receipt) for the authoritative procedure.

### Storage and ownership

See [Storage and ownership](../packages/app-verify/OPERATIONS.md#storage-and-ownership) for the authoritative procedure.

### Supervisor and lease

See [Supervisor and lease](../packages/app-verify/OPERATIONS.md#supervisor-and-lease) for the authoritative procedure.

### Browser session and secrets

See [Browser session and secrets](../packages/app-verify/OPERATIONS.md#browser-session-and-secrets) for the authoritative procedure.

### Frozen proof

See [Frozen proof](../packages/app-verify/OPERATIONS.md#frozen-proof) for the authoritative procedure.

### Preview identity and staleness

See [Preview identity and staleness](../packages/app-verify/OPERATIONS.md#preview-identity-and-staleness) for the authoritative procedure.

## Failure behavior the adapters must implement

| Situation | Behavior |
| --- | --- |
| Concurrent runs | Distinct run ids, unit names, ports and directories; `doctor` lists all; no shared state. A wrapper may [refuse a second live run](#one-run-at-a-time) on the host |
| Occupied port | Never happens for the run's own WSL listener, which binds port 0. A fixed-port dependency the application insists on is a `start` failure naming the port, not a retry loop. A Windows process already on the chosen number is the pending host behavior below; `doctor`'s Windows reachability check is how it would show |
| Stale build | `dirty` and `unknown` are labelled at `start`, in the card and in the receipt. Proof from a dirty run cannot be cited as a merge candidate's evidence |
| Interrupted start | A unit that fails kills the rest of its control group; `start` reports `failed`, removes the runtime directory and stops the timer. A `start` interrupted before its `starting` receipt exists leaves nothing. Interrupted later, it leaves a `starting` receipt and whatever it had created; `doctor` lists that run and `stop` removes what exists, and because the timer precedes the unit an application is never left without a lease |
| Agent exit | The unit and timer belong to the user manager, not the agent's session, so the run keeps serving until expiry or `stop`, and the next session finds it with `doctor`. `apps/hub/verify/tests/runs.test.mjs` proves it with a stand-in: stopping the transient scope the wrapper ran in leaves the run serving. The user manager's lifetime without linger stays with ADR 0008 |
| Stale process identity | Unit name, `MainPID` and start timestamp must all match the receipt, otherwise `stale`; cleanup goes through the unit, never a PID |
| Failed capture | Recorded as `failed` with the reason and whatever partial artifact exists; the run continues; the assertion failure is the result |
| Unavailable browser tooling | `capture` reports `unavailable` naming the missing piece (Playwright module, Chromium build, ffmpeg); `start`, `handoff`, `extend` and `stop` still work |
| Expired lease | Unit stopped by the timer and unloaded; `doctor` shows `expired` because `preview.expiresAt` has passed; `stop` removes the runtime directory and records `state: expired`; the frozen set is unchanged |
| Runtime directory missing | For a `starting` or `running` receipt, `doctor` reports `stale` with `runtime-dir-missing`, and `stop` still stops the unit and timer and records `cleanup.result: partial` with the directory `absent`. A `failed`, `stopped` or `expired` receipt expects no runtime directory, except an expired run's, which `stop` removes |

## Actual and simulated components

| App | Actual | Simulated or synthetic | Boundary evidence the adapter must show |
| --- | --- | --- | --- |
| Hub | Hub service, B.U.N.N.Y. dashboard, browser sessions, command replay | Fake loopback controllers and Sony receiver from `apps/dashboard/tests/fixture.mjs`; synthetic lifecycle events | Controller writes are observed on the fake; read-only browsing writes no command |
| Nanoleaf wall | Wall server, map page, private SQLite state, allocation and Prism rendering | Worker stand-in (`scripts/demo.py` `prepare`), synthetic projects and tasks, fixture layouts | The demo's `request=no_device` trap raises on any light request; the adapter proves an attempted request fails |
| Pixoo | Fastify server, web UI, library, playlists, player | Simulator transport, synthetic media in a private `PIXOO_DATA_DIR` | `/api/health` reports simulator mode and no device connectivity; ambient `PIXOO_MODE=device` does not leak into the run |
| CHOMPI bridge | Bridge CLI (`run --simulate --desktop sim`) with its routing core, slot store, lights, profile watcher and feed client; the run's control page | `ChompiSimulator` (HID protocol v1), `SimulatedDesktop` behind OS adapter interface version 6, `SyntheticHub` feed (snapshot 1.3 and change stream) with a run-generated token; synthetic tasks and text | `no-hid-device`, `no-desktop-calls` and `own-feed-only`: simulator transport only with node-hid refused, simulated desktop only with koffi refused, and only the run's own origin and lock; tests start a run across each boundary and show its check fails |
| Runtime | The runtime through its own entry (`runMain`) with `--simulate`, `--edge` and the run's state directory, its SDK edge, and the supervisor's harness API; the preview links the runtime's health page | The fixture modules (the core with its stand-in parts, the lamp and the chime), `SimulatedLamps` and `SimulatedChime` reached over the runtime child's IPC channel, and the scenario's remote parts with run-generated grants | `simulated-transports`, `no-outbound-connections` and `private-state`: the runtime says it ran with `--simulate`; a guard loaded through `NODE_OPTIONS` into the runtime, the worker threads and Node processes that inherit its environment refuses each outbound TCP connection (`net`, `tls`, `http`, `https`, `fetch`) and UDP datagram (`dgram`) before anything leaves; and the run observes the runtime's home inside the run, nothing under its default state directory and every database it has open in the run's state directory. The guard does not cover a native addon, a non-Node binary, a process or worker thread started with `NODE_OPTIONS` cleared or replaced (a worker given its own `env`, or an `eval` worker), or a `node:dns` lookup. Tests start a run across each boundary and show its check fails |

## Caller walkthrough

<a id="agent-verify-retain-proof-hand-off"></a>

Use the adapter for the candidate you changed. Current runtime commands use
`npm run -s verify:runtime --`; legacy Hub commands use `npm run -s verify --`.
The runtime adapter's [entry points](../apps/runtime/verify/README.md#entry-points)
own available scenarios, capture steps and their evidence limits. Select affected
scenarios using [runtime development](../apps/runtime/DEVELOPMENT.md#runtime-verification-runs).
The [retained Hub example](../apps/hub/verify/WALKTHROUGH.md) and
[composition guide](../apps/hub/verify/COMPOSE.md) are separate paths.

1. Build the candidate, then inspect the adapter's `help` and `prerequisites`.
   A successful prerequisite inspection proves no launch, capture or handoff.
2. Start a synthetic scenario. Require the run's own clean revision, build digest,
   endpoints and lease; never substitute installed ports, stores or devices.
3. Exercise the affected capture steps against that run. Require passed
   assertions and completed screenshot/video evidence. Prove negative controls
   in tests or a separate run; failed controls must not enter the handed-off
   verified set. Follow [SDLC](sdlc.md#acceptance-review) for independent acceptance.
4. Use `handoff` to freeze proof and, when needed, reset to the intended preview
   scenario. Share the preview card and returned proof URLs only within their
   authorized audience. URLs expire with the run; retained frozen files survive
   stop. Report whether attachments were actually included.
5. Use `doctor` to inspect the run, extend only its lease if needed, and stop it
   when finished. Verify cleanup. On a failed start or interrupted operation,
   follow the [operation failure contract](../packages/app-verify/OPERATIONS.md)
   and the selected adapter's recovery instructions; missing or skipped evidence
   never establishes qualification.

### Human: explore, extend, let it expire or stop

Use the handed-off card and the selected adapter's `extend`, `doctor` and `stop`
operations. Preview interactions never modify frozen proof. The
[operation contract](../packages/app-verify/OPERATIONS.md) owns lease and cleanup
behavior; the [legacy Hub example](../apps/hub/verify/WALKTHROUGH.md) preserves its
specific commands.

### Restart later

The selected adapter's `restart` creates a new run and records its predecessor.
Check its new revision and dirty/build identity before using it as evidence.

### Failed start

Read the adapter's refusal and required prerequisite. No listener, unit or
capture is qualified merely because a command returned a diagnostic. The
[legacy Hub example](../apps/hub/verify/WALKTHROUGH.md#failed-start) retains that
wrapper's unbuilt-core recovery path.

## Feasibility findings, 2026-09-27

Bounded probes on the owner's PC (WSL 2.6.2 in NAT mode, systemd 259, Windows
10.0.26200, `curl.exe` 8.21.0, repository Playwright 1.63.0 with Chromium
153.0.8010.12). Each probe used a throwaway loopback listener and transient
units named `gh493-probe-*`, all stopped afterwards. No installed service,
network setting or device was touched. Scripts and captured artifacts are kept
outside Git in the canonical checkout's
`.local/evidence/gh-493-app-verification/`.

| Probe | Hypothesis | Smallest probe | Stop condition | Result |
| --- | --- | --- | --- | --- |
| E1 Windows to WSL loopback | A WSL listener on `127.0.0.1:0` is reachable from Windows at the same port without configuration | Node listener in WSL; `curl.exe` from Windows against `127.0.0.1:<port>` and `localhost:<port>`; `netstat.exe` | One success or failure per address | Both answered 200 (2.6 ms and 217 ms; `localhost` resolved to 127.0.0.1). Windows `netstat` shows the port mirrored as a Windows `LISTENING` socket. After the listener stopped, the same request failed with an empty reply, so a stale link does not show old content |
| E2 Session-independent lifetime and lease | A transient user unit outlives the session that started it, a transient timer can stop it, and the lease can be extended | `systemd-run --user` listener; `--on-active=30` timer running `systemctl --user stop`; replace the timer with 45 s; `set-property RuntimeMaxSec`; second `systemd-run` with the same name | Timer fires or 2 minutes | The unit ran under `user@1000.service/app.slice` with the user manager as parent while the calling shell sat in `init.scope`. `set-property` refused `RuntimeMaxSec`. Replacing the timer moved the next elapse, and the listener stopped 45 s after start, exactly at the replaced lease. The duplicate name was refused (`already loaded`). An actual end-of-session observation was not taken; independence rests on the cgroup and parent evidence |
| E3 Screenshot and video capture | The repository's pinned Playwright can record a stateful interaction to WebM and a PNG in WSL | `capture.mjs`: two clicks on a counter page under `recordVideo`, then a screenshot | One run | 7.2 KB PNG showing counter 2 and a 9.2 KB VP8 WebM of 1.08 s at 1280×800 in 521 ms. The video file exists only after the context closes, so a crashed capture must be reported as failed rather than assumed |
| E4 Partial-start cleanup | A unit whose start script spawns a `setsid` helper and then fails leaves nothing behind, and a plain process-group kill would not | `partial-start.sh` under `systemd-run` with `KillMode=control-group`; then the same tree under a plain process group with `kill -TERM -- -<pgid>` | Process listing after each | After the script exited 3, the unit's control group was empty and `stop` removed it; no `sleep` survived. Under the plain process group the direct child died and the `setsid` grandchild survived the group kill, which is why the contract forbids PID and group based cleanup |

Pending host behavior, left explicit rather than inferred:

- A Windows browser window opening the card's link by an owner's click is
  #497's evidence. E1 proves the Windows loopback relay for HTTP, not the
  browser session flow.
- A Windows process already listening on the number WSL picked. The relay's
  behavior is untested; `doctor` therefore includes a Windows reachability
  check through `curl.exe` when interop is available and reports `skipped`
  when it is not.
- The user manager's lifetime without linger (`Linger=no` on this PC). The
  run's independence from the starting session's processes is covered by the
  Hub's scope-stop test, but today the manager is wanted by the WSL
  distribution's implicit login session. So the distribution's lifetime with no
  terminal open bounds every lease (ADR 0008 trial pending).
- CI: Depot's Ubuntu runner, used until #870, was not booted with systemd
  (PR #552). GitHub-hosted runners have a user manager, but the lease timer
  does not read back under their systemd 255 (#873), so the App verification
  job hides the user bus. CI runs
  the core's receipt, supervisor-refusal, lock and unsupervised capture tests
  (through `runCaptureStep`) and the CHOMPI bridge and runtime adapters'
  verification suites. The lifecycle tests skip there with a printed reason
  and run on this PC. Since #827 the Hub adapter's tests run locally, not in
  CI, until #839 deletes the old Hub: its `steps.test.mjs` (its seven fixture
  reference steps, including the three Hub #336 moment steps, under every
  seeded fault, and its two `control-*` steps), `build.test.mjs` and its run
  tests.
- Codex sandbox: this session ran from Claude Code, where Windows interop and
  `systemd-run` work. Earlier evidence shows Codex's sandbox refusing Windows
  interop; whether it can create user units is unknown until tried there.
- Preview behavior across Windows sleep and resume: unknown.

## Adapter acceptance

The shared core's suite (`packages/app-verify/tests`) proves the
application-independent part of each clause once, against real transient
units and a fixture application: the **core** column. Those lifecycle tests
need a user manager, so they run on a systemd host such as the owner's WSL
PC, and the delivery evidence records them. The App verification CI job hides
the runner's user manager (#873), so it runs only the parts that need none:

- receipt validation, including the optional 1.1 fields;
- the receipt lock under contention, including a lock left by a killed
  writer, a stuck or holder-less lock breaker, a prepared lock directory
  swept mid-acquire and a stale dead-breaker record;
- `start` refusing without a manager;
- input refusals (undeclared, secret-like, missing, malformed) and inputs
  given to `runCaptureStep`;
- a served artifact that changed before or during a step, through
  `runCaptureStep` with the recorded digest;
- the capture rules through `runCaptureStep`: reference, `control-*`,
  `false` predicates, a broken app, a silent step, missing tooling, and
  unfinalized or truncated video.

`npm run test:app-verify:package` repeats the suite from the packed archive.
Each adapter's own checks then prove the clause through its plug-in, with at
least one real `start`, `capture` and `stop` of its application on a systemd
host, in addition to its issue's acceptance list:

| Clause | Core (`@jimmie-potts/app-verify`) | #494 Hub | codex-nanoleaf#193 | divoom-app-upgrade#118 |
| --- | --- | --- | --- | --- |
| Operations and receipt shape | Every operation; every receipt write validated | All operations; receipt validated against the fields above | Same, using `demo.py` `prepare` as the seed | Same, wrapping the simulator entrypoint |
| Readiness and build identity | Ready line, probe, digest by route, file or file list, dirty flag | `{ready,url}` line, health, `/dashboard.js` digest, dirty flag | `{url}` line, map page read, dirty flag | `/api/health` selected mode, dirty flag |
| Supervisor, lease, extend, stop, expiry | Real transient unit, make-before-break extend, a lease that expires, degraded and missing managers | Uses the core | Same | Same |
| Two concurrent runs share nothing | Two runs, two ports, reseed of one leaves the other unchanged | Two runs, two ports, independent reset | Same | Same, two `PIXOO_DATA_DIR`s |
| Failed start cleans up | Readiness timeout, exited unit with a `setsid` helper, seed and check failures | A broken build or readiness timeout leaves no unit, timer or runtime directory, and a `failed` receipt that `doctor` lists | Same | Same |
| Interrupted start is discoverable | Killed after seeding (`stale`) and while waiting for readiness (`starting`) | Uses the core | Same | Same |
| `doctor` identity and expiry | Another start timestamp, a missing lease or runtime directory, an orphan unit, `expired` | Uses the core | Same | Same |
| `scenario` reseeds only this run | Relaunch on the same port with the lease unchanged | A second run's state is unchanged by the first run's reseed | Same | Same |
| `restart` names its predecessor | `restarts`, `same-candidate` or `different-candidate`, `dirty` label | Uses the core | Same | Same |
| Capture and failed capture | Settled-state assertions; a wrong expectation, a `false` predicate, a known-broken app, a step without assertions, an unfinalized or truncated video and SIGTERM or SIGKILL interruption all `failed`; missing tooling `unavailable`; each record names its scenario | Screenshot and video of a stateful step; a known wrong result is reported as failed | Same for a task transition | Same for playlist progression |
| Frozen proof | `SHA256SUMS` unchanged after reset, extend and a later capture, labelled `after-handoff`; a changed file, manifest or entry type is `tampered` and a removed manifest `missing` | Uses the core | Same | Same |
| Secrets and session path | The receipt, card and logs carry no credential the core knows | Trusted-loopback sign-in; no token in card, log or receipt; API assertions with a run-generated credential | Page token never printed | No credential exists; ambient `PIXOO_MODE=device` is overridden and proven by `/api/health` |
| Simulated boundary | Plug-in boundary checks fail the start | Fake controller observed; read-only browsing writes nothing | Light request trap raises | No physical transport request |

A negative control is an ordinary capture step named `control-*` that reports
`failed` by design; adapter tests assert that it fails. A run cited as a
change's delivery proof runs its `control-*` steps in tests (through
`runCaptureStep`) or after handoff, so its verified set holds only passed
captures: the delivery preflight (#496) rejects a verified set with any
capture that did not pass. There is no
expected-failure mode that turns a failure into a pass. On a CI host without
`systemd --user`, an adapter can still run its reference and `control-*` steps
against an application it started itself with `runCaptureStep`, which judges a
step exactly as `capture` does.

The executable behavior these clauses describe arrives with those issues. The
core package and the Hub adapter are verification tooling with no product
behavior change, so #494 carries no OpenSpec delta, like #493.

## Composed previews

See [Composed previews](../apps/hub/verify/COMPOSE.md#composed-previews) for the authoritative procedure.

### Pinned sources

See [Pinned sources](../apps/hub/verify/COMPOSE.md#pinned-sources) for the authoritative procedure.

### Start and pairing

See [Start and pairing](../apps/hub/verify/COMPOSE.md#start-and-pairing) for the authoritative procedure.

### The composition record

See [The composition record](../apps/hub/verify/COMPOSE.md#the-composition-record) for the authoritative procedure.

### Reset and interrupted operations

See [Reset and interrupted operations](../apps/hub/verify/COMPOSE.md#reset-and-interrupted-operations) for the authoritative procedure.

### Cross-service proof and loss

See [Cross-service proof and loss](../apps/hub/verify/COMPOSE.md#cross-service-proof-and-loss) for the authoritative procedure.

## Deferred

No LAN or phone hosting, remote fleet, continuous preview service,
physical-device accuracy or general process-management platform. Revisit
wider access only after #497 qualifies the same-PC path. The in-page expiry
banner is deferred with the card and `doctor` as the manual alternative;
revisit it when an adapter owns a page it can render in, or when #497 records
a person misled by a stale link. A composition has a loss step only for
Pixoo; add a wall loss step when a change to the wall's pairing needs one.

## Explicit host route for Codex development coordinators

`npm run -s verify:host -- --help` describes the Hub-owned dispatcher from
[#611](https://github.com/jimmie-potts/agent-device-hub/issues/611). The owner
accepted this boundary in [#610](https://github.com/jimmie-potts/agent-device-hub/issues/610).
It is an explicit route for trusted verification commands, executed as the
Linux user outside the Codex sandbox. Access to the user manager can launch
arbitrary host processes, and checkout code is mutable. Codex denied-file and
network rules do not constrain those host processes. The dispatcher is not a
security sandbox; synthetic-only behavior, secret exclusion and owned cleanup
remain workflow requirements.

The required qualification targets are Desktop with WSL execution, interactive
WSL Codex CLI and WSL `codex exec` development coordinators. Each independent
chat owns its runs. Delegated workers request preview operations through their
coordinator. Standards and Specification reviewers stay read-only. An
Acceptance reviewer owns its own disposable runs within the authority in
[Acceptance review](sdlc.md#acceptance-review) (owner decision, 2026-10-05). Fresh-client and two-session acceptance
are [#613](https://github.com/jimmie-potts/agent-device-hub/issues/613), not a
claim made by this source delivery.

### Prepare and invoke

Use Linux with systemd user services (the diagnosis used systemd 259), Node
24.5+ in the 24.x line, and the existing application prerequisites. From the
assigned Hub checkout run `fnm exec --using=.nvmrc -- npm ci` and
`fnm exec --using=.nvmrc -- npm run build`. Prepare each selected consumer
checkout using its own guide. Use the Nanoleaf controller-requirements virtual
environment's absolute Python path and the absolute fnm executable for Pixoo
composition. No packages, services, permissions or personal settings are
installed by the dispatcher.

For example, replacing the placeholder paths with prepared assigned checkouts:

```bash
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app hub --checkout /absolute/hub-worktree -- prerequisites
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app hub --checkout /absolute/hub-worktree -- start --scenario lifecycle-basic
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app hub --checkout /absolute/hub-worktree -- doctor
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app runtime --checkout /absolute/hub-worktree -- start --scenario end-to-end
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app nanoleaf --checkout /absolute/wall-worktree --python /absolute/venv/bin/python -- start
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app pixoo --checkout /absolute/pixoo-worktree -- start
fnm exec --using=.nvmrc -- npm run -s verify:host -- --host --app compose --checkout /absolute/hub-worktree --python /absolute/venv/bin/python --fnm /absolute/bin/fnm -- start --checkout nanoleaf=/absolute/wall-worktree --checkout pixoo=/absolute/pixoo-worktree
```

Use the same launcher options with existing `capture`, `handoff`, `extend` and
`stop` arguments. The selected checkout must have the matching package identity
and adapter entrypoint. The composition retains its existing source pins; its
explicit `--unpinned` option still labels development-only evidence. Run one
preview at a time on a host ([one run at a time](#one-run-at-a-time)); each
uses its own worktree and build outputs, including both consumer checkouts for
each composition. One coordinator controls each run;
do not capture, reset or stop another coordinator's run.

The `prerequisites` adapter operation is read-only. Invoking it through
`verify:host` still creates the dispatcher's bounded command unit and temporary
directory, then checks their cleanup. That host routing effect requires the
same explicit authority as other host commands. Use the direct local command
for inspection without a host command unit. Composition has no aggregate
prerequisite command; inspect each selected adapter, checking help support for
older consumers first.

The launcher clears the manager environment with `/usr/bin/env -i`, selects
Node from its own Node-24 process and supplies only the Linux home, a tool PATH,
locale, user-bus/runtime paths, owned temporary storage, shared npm/Playwright cache paths,
`APP_VERIFY_SINGLE_RUN=1` (the [one-run guard](#one-run-at-a-time)) and explicit
optional `PYTHON`. It forwards neither the caller's tokens/preload variables nor
app-verify storage overrides. Proof and runtime therefore retain the adapter's
canonical roots. The systemd client uses the session bus; it does not silently
change profiles, grant socket access or retry with broader permissions.

Each command sets `TMPDIR` to a private directory under the launcher's canonical
Hub checkout, `.local/scratch/vh-<random>`. The checkout must ignore `.local/`
and its resulting temporary path must be at most 70 bytes to leave room for
browser socket paths. Use a short canonical checkout when preparation refuses
this limit. Temporary browser profiles and artifacts stay on disk; finalized
proof stays in the adapter's canonical proof directory. The host helper creates
the directory exclusively with an ownership token. systemd's `ExecStopPost`
removes it after normal exit or forced termination, but refuses a mismatched
owner. Preview services retain their own runtime `TMPDIR` and leases.

### Readback and recovery

Before launch, stderr announces a unique `app-verify-command-*.service` unit.
Every invocation has a 900-second default command lifetime, configurable with
`--timeout-seconds` from 30 to 1800 before `--`. Stop timeout is five seconds;
client timeout and bounded stop/readback can add up to 30 seconds. An operation
that needs longer than this bound is unsupported by this route. Command stdout
and stderr are each limited to 2 MiB; excess output is an uncertain result.

Stdout is one JSON envelope: `hostCommandVersion`, selected `app`, `checkout`,
`operation`, command `unit`, `temporary`, `temporaryCleanup`, `state`, `cleanup`,
`adapterExit`, and the original
adapter object in `result`. A completed result requires exit zero, a parseable
adapter object, verified removal of the command unit and removed temporary storage. Existing nonzero
adapter codes and results are preserved. `completed` describes the operation,
not browser, device or whole-session qualification. Raw process stderr is not
copied into this result.

Command units and preview units have different lifetimes. A finished command
does not stop its preview or change the preview's lease. On interruption, lost
output or unreadable cleanup, the dispatcher returns `uncertain` and never
retries start. Reconcile through the selected checkout's `doctor`, canonical
receipts and announced command unit before starting again. An interrupted start
may already have created a leased preview before its run ID reached the caller.
Never infer preview cleanup from command cleanup, and never kill by port. If
command cleanup remains unknown, stop and read back only the announced command
unit through the accepted host route or a trusted terminal. Stop previews only
by their verified run IDs. `temporaryCleanup` is `removed`, `retained` or
`unknown` after launch. A retained or unreadable directory makes the result
uncertain. After command-unit cleanup, inspect the reported path and its
`.owner` token: it must equal the UUID in the announced command unit. Use the
host helper's `cleanup <reported-path> <exact-token>` operation from a trusted
terminal to retry that owned removal. A manager crash can prevent `ExecStopPost`;
keep the reported path for this recovery rather than deleting a scratch glob.

Rollback means stopping the exact owned previews and command units, preserving
frozen proof, and ceasing to select this route. No personal settings need to be
restored. If a fresh client needs a persistent permission change, prepare its
exact diff, backup, readback and rollback for owner acceptance under #613.
The source fixtures do not prove live listener ownership, Windows links or
survival after an originating Codex chat ends; #613 retains those checks.
