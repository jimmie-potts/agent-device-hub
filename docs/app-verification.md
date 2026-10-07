# App verification interface

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

Every operation prints one JSON result line on stdout and progress on stderr.
No operation prints a token, a private path outside the receipt's two declared
roots, or personal data. For lifecycle operations, exit status 0 means the
outcome was verified, not merely requested; 1 is a failed outcome, 2 a usage
error and 3 unavailable required tooling. `help` lists the operations, the adapter's
scenarios and its capture steps and, since 1.1, its declared inputs, each
scenario's required inputs and the core version.

Since source version 1.3, `prerequisites` is a separate local, read-only
diagnostic. It reports platform, user-manager visibility, storage-root
admissibility and access heuristics, tools, browser files, and any adapter's
read-only build check. It does not create state, launch a unit or browser,
bind a socket or contact an app. The launch, capture and handoff operation
summaries remain `unproven` even when every inspected requirement is present.
Its exit 0 means inspection completed; a known missing requirement exits 3.
Older pinned consumers that omit it from `help.operations` are unsupported.

The diagnostic trusts the installed standard Playwright dependency and the
adapter's read-only hook. Custom browser modules are resolved without executing
their initialization; their browser-file evidence stays unknown. Video tooling
is explicitly uninspected because Playwright exposes no public ffmpeg path API.
Adapter text must be fixed, non-secret metadata; shape validation does not
sanitize arbitrary private values. A missing adapter check must include a next
action, and adapter checks cannot replace core evidence.

| Operation | Outcome | Failure it must report |
| --- | --- | --- |
| `prerequisites` (1.3) | Local read-only checks with `present`, `missing`, `unknown` or `unsupported` status and separate launch, capture and handoff summaries; writes, host launch, listener ownership, browser execution, video finalization and Windows handoff stay unproven | Known missing local requirements name a next action; unreadable or uninspected evidence stays unknown |
| `start [--scenario <name>] [--lease <minutes>] [--input <name>=<value>]...` | In this order: writes the proof directory with a `starting` receipt naming the unit, timer and runtime directory it is about to create; runs the adapter's optional build step; creates the runtime directory and seeds the scenario; starts the lease timer; starts the application under its supervisor unit; waits for readiness; runs the adapter's boundary checks; rewrites the receipt with `state: running`. The timer exists before the unit, so no running application is ever without a lease | Occupied or unusable port, dirty or unknown build, readiness timeout, seed failure, supervisor unavailable. A failed start stops its unit and timer, removes its runtime directory and reports `state: failed` with the cause and what was cleaned |
| `doctor [<run-id>]` | Reads live state without changing it: the unit's active state, main PID and start timestamp, the ports the unit's own processes listen on (from its control group and `ss`) against the recorded port, a loopback health read, the build identity the process reports or the receipt recorded, the lease timer's next elapse, the verified set's checksums, and any boundary check the adapter marks read-only. Without an argument it lists every run of this app discovered from the union of `app-verify-<app>-*` units and timers, runtime directories and receipts, so an orphan of any kind appears. A run whose unit is gone while its receipt says `running` or `starting` is `expired` when `preview.expiresAt` has passed and `stale` otherwise | A receipt that disagrees with the live unit is reported as `stale`, never repaired silently |
| `scenario <run-id> <name> [--input <name>=<value>]...` | Reseeds this run's disposable state to the named scenario while the run keeps its identity, port and lease: stops the application unit, empties its state, seeds, and relaunches it on the recorded port and endpoint ports. Each `--input` replaces that input's recorded value; the others are kept. Only this run's runtime directory changes | A scenario the fixtures do not define; a run that is not `running`. A reseed that fails after the application stopped ends like a failed reset below: `state: stopped`, `failure.cause: reset-failed` |
| `capture <run-id> <scenario-step>` | Drives the real page in the pinned Playwright Chromium against this run, asserts the step's expected observations, and writes a screenshot, a short video of the stateful interaction and the assertion log into a new `capture-<n>/` directory: before handoff in the proof directory, after handoff under `after-handoff/`. Failed assertions are preserved as failures with their screenshot. Since 1.1 it re-reads the served artifact before and after the step: several runs of one checkout serve the same build on disk, so a rebuild can change what this run serves | Missing browser tooling, a crashed page, a video that was not finalized, an assertion failure, and a served artifact whose digest no longer equals `build.artifactDigest` (`the served artifact changed since start (recorded …, served …)`; the page is not driven when it differs before the step). Each is a `capture.outcome` of `failed` or `unavailable` with the reason, never a successful-looking screenshot |
| `handoff <run-id> [--reset <scenario>]` | Freezes the verified set (moves the captures so far and a copy of the receipt into `verified/`, writes its `SHA256SUMS`, removes write permission from it, records `proof.frozenAt`), optionally reseeds the run's state so the human starts from known data, and prints the preview card: URL, run id, candidate, expiry, and how to extend or stop | A run whose verified set is already frozen accepts another `handoff` only to print the card again; it never rewrites the frozen set. A reset that fails stops the unit and timer, removes the runtime directory, records `state: stopped` with the cause in `events.jsonl` and `cleanup.result`, and keeps the frozen set, rather than serving half-seeded state |
| `extend <run-id> [--lease <minutes>]` | Starts the next lease timer (`app-verify-<run-id>-lease-<k>.timer`), reads back that it elapses at the new expiry, then stops the old timer, so the run is never without a lease. Records the new expiry in the receipt and the printed card | A run whose unit is not active, or whose new timer cannot be started, is reported as such; the old lease and everything else stay untouched |
| `stop <run-id>` | First stops every lease timer of the run and the supervisor unit, verifies each is gone and removes the runtime directory. Then, under the receipt lock, recovers the proof of a run that was never frozen. It reports `proof: committed` (a complete own set left by an interrupted handoff), `unwound` (partial or rebuildable captures returned to the proof directory) or `conflict` (files left for inspection, cleanup unaffected). Finally it writes the receipt with `cleanup.result`: `state: expired` when the lease had already stopped the unit, `stopped` otherwise. A `receipt-locked` refusal still reports the cleanup done. Frozen proof stays. Repeating `stop` reports the final state without rewriting it. With an unreadable or invalid receipt, `stop` still cleans up through the unit names the run id gives, reports `state: stale` and `receipt: unreadable`, and leaves the file as found for diagnosis. It removes only the runtime directory: a `HOME` or `TMPDIR` a plug-in moved elsewhere is the plug-in's to clean | A unit that will not stop within its timeout is reported with its unit name for the owner; the adapter never kills by port, process name or a remembered PID |
| `restart <run-id>` | `stop`, then `start` with the recorded scenario, inputs and candidate, producing a new run id whose receipt names the run it restarts | A changed working tree makes the new run a different candidate; the receipt says so instead of claiming continuity |

Since `app-verify` 1.1, a plug-in may declare **run inputs**: named,
non-secret values such as another run's loopback URL, given with `--input`.
The core refuses, as a usage error before any run changes, an undeclared
name, a missing required input, a value that is not 1 to 512 printable ASCII
characters and a name matching `/token|secret|password|credential|key/i`.
It records them in the receipt and the `seeded`, `unit-started` and
`reseeded` events, and every reseed, `fresh` step, `handoff --reset` and
`restart` reuses them. A scenario can list `requiredInputs`, and seeding it
without them is the same usage error, raised before anything stops.

A credential, or a path to one, never travels as an input. A caller that must
supply one writes it with mode 0600 into the run's runtime directory,
`<runtime root>/<run-id>/`, outside `data/`, `tmp/` and `home/` so that a
reseed keeps it. The plug-in reads it by a fixed file name from
`ctx.runtimeDir`. `start` creates the directory, so the caller writes the file
after `start` and before the `scenario` reseed that needs it, and `stop`
deletes it with the directory. Such a scenario cannot be a run's first seed,
and `restart` of a run in it stops the run and then fails at seed, because the
new run's directory does not exist yet: stop the run, start a new one in a
scenario that needs no file, write the file and reseed.

A ready line may also name **extra endpoints**: other loopback listeners of
the same application, such as a fake controller that another run calls. Each
is exactly `http://127.0.0.1:<port>/`, with no path, credentials, query or
fragment, and a ready line names at most 16. They follow the port rules below
and are recorded and printed in the card. They keep their ports across a
relaunch, or the reseed fails with `port-changed`, and `doctor`'s listener
read covers them. Since 1.1 the main URL also refuses credentials, a query or
a fragment.

A `stop` retried after a `receipt-locked` refusal records the cleanup the
refused attempt did.

Expiry is not an operation. The lease timer stops the unit, and the next
`doctor` reports `state: expired`, the exact expiry time and that the runtime
directory is still to be removed by `stop`. The frozen set is unaffected.

### Readiness and build identity

`start` succeeds only after a loopback read of the application's own readiness
route answers as expected: the hub's `{ready:true,url}` startup line and
`GET /api/hub/v1/health`; the wall demo's `{url}` startup line and its map page;
Pixoo's `GET /api/health` reporting simulator mode. The receipt's `build` uses the
field names the [install contract](https://github.com/jimmie-potts/agent-device-hub/issues/465)
proposes for running processes, so a later health field
([#428](https://github.com/jimmie-potts/agent-device-hub/issues/428)) needs no
receipt change:

- `build.sourceRevision`: the full commit of the checkout the adapter built
  from, or `unknown` when the checkout has no readable commit.
- `build.dirty`: `true` when `git status --porcelain` lists tracked changes at
  start. A dirty build is served, because agents verify their own uncommitted
  work, but every card and receipt labels it `dirty`. A merge candidate's proof
  must come from a clean run.
- `build.artifactDigest`: a SHA-256 of the served bundle the adapter names, for
  example the hub's `/dashboard.js`, so two builds of one version stay apart.
- `build.version`: the package version, informational.

### Receipt

One `receipt.json` per run at the top of its proof directory, rewritten by
each operation that changes state, with an append-only `events.jsonl` beside
it. Neither file is part of the frozen set; handoff copies the receipt of that
moment into `verified/`. The proof directory therefore holds `receipt.json`,
`events.jsonl`, `capture-<n>/` until handoff, then `verified/` (the moved
captures, `receipt.json` copy and `SHA256SUMS`) and any `after-handoff/capture-<n>/`.
Fields, all required unless marked optional. A `starting` receipt sets the
values it cannot know yet to `null`: `owned.port`, `owned.mainPid`,
`owned.mainStartMonotonic`, `preview`, `scenario.seededAt`,
`build.artifactDigest` and an empty `captures` list. A receipt without
`preview.expiresAt` whose unit is gone therefore reads `stale`, never
`expired`. `validateReceipt` in the core package checks every field below:

```json
{
  "receiptVersion": "app-verification/1",
  "runId": "hub-20260927T060259Z-3f9a1c",
  "app": "hub",
  "repository": "jimmie-potts/agent-device-hub",
  "roots": {"proof": "<canonical checkout>/.local/evidence/verify", "runtime": "~/.local/state/app-verify"},
  "state": "running",
  "startedAt": "2026-09-27T06:02:59Z",
  "restarts": "hub-20260927T052001Z-91be07",
  "build": {"sourceRevision": "4adfbf480a5bc3000cf99aec10226403d391a299", "dirty": false, "artifactDigest": "sha256:…", "version": "0.4.0"},
  "scenario": {"name": "lifecycle-basic", "version": "4adfbf480a5bc3000cf99aec10226403d391a299", "seededAt": "2026-09-27T06:03:01Z"},
  "components": [
    {"id": "hub", "kind": "actual"},
    {"id": "dashboard", "kind": "actual"},
    {"id": "wall-controller", "kind": "simulated", "note": "fake loopback controller from apps/dashboard/tests/fixture.mjs"},
    {"id": "ht-a9", "kind": "simulated"}
  ],
  "checks": [{"id": "readiness", "outcome": "passed"}, {"id": "windows-loopback", "outcome": "skipped", "reason": "interop unavailable"}],
  "captures": [{"n": 1, "step": "task-appears", "scenario": "lifecycle-basic", "set": "verified", "outcome": "passed", "screenshot": "verified/capture-1/after.png", "video": "verified/capture-1/interaction.webm", "log": "verified/capture-1/assertions.json", "startedAt": "2026-09-27T06:04:00Z", "finishedAt": "2026-09-27T06:04:03Z"}],
  "preview": {"url": "http://127.0.0.1:41705/", "expiresAt": "2026-09-27T08:02:59Z", "leaseMinutes": 120},
  "owned": {"unit": "app-verify-hub-20260927T060259Z-3f9a1c.service", "leaseTimer": "app-verify-hub-20260927T060259Z-3f9a1c-lease.timer", "port": 41705, "runtimeDir": "hub-20260927T060259Z-3f9a1c", "proofDir": "hub-20260927T060259Z-3f9a1c", "mainPid": 4242, "mainStartMonotonic": 218551931014},
  "proof": {"frozenAt": null},
  "failure": null,
  "cleanup": {"result": null},
  "secrets": "none recorded"
}
```

- `state` is one of `starting`, `running`, `failed`, `expired`, `stopped`.
- `failure` is `null`, or `{cause, at, detail?}` for a failed start or a run
  the core stopped itself. A `failed` receipt always has one. `cause` is
  kebab-case: `supervisor-unavailable`, `proof-root-unusable`,
  `runtime-root-unusable`, `build-failed`, `seed-failed`, `lease-failed`,
  `launch-failed`, `unit-exited`, `readiness-timeout`, `port-changed`,
  `port-reserved`,
  `artifact-unreadable`, `check-failed` or `reset-failed`. `at` is the UTC
  time it was recorded; `detail` is one line without secrets. An adapter may
  add its application's own stable cause line from the tail of the app's
  stderr (`readiness.failureCause`), appended as `; app: <line>` when it is
  printable ASCII of at most 200 characters; the core never records raw log
  text. Since 1.1, `detail`, like a check's or capture's `reason` (also as
  `doctor` prints it) and a supervised capture log's assertion errors and
  notes, has every absolute path outside the two roots replaced with `<path>`
  and is capped at 1000 characters. Full URLs are kept, so a reason names a
  route by its URL.
- `cleanup.result` becomes `clean`, `partial` or `unknown` (a readback
  failed). `cleanup.at` records when, and `cleanup.items` lists one
  `{kind, name, outcome}` per lease timer, the unit and the runtime
  directory. `outcome` is `removed`, `absent`, `left` (still there, named for
  the owner) or `unknown`.
- `owned.mainPid` and `owned.mainStartMonotonic` are the live unit's
  `MainPID` and `ExecMainStartTimestampMonotonic`, which `doctor` compares.
- Each capture records the `scenario` the run was seeded with when the step
  ran (and `fresh: true` when the core reseeded it just before), its
  assertion `log`, `startedAt`, `finishedAt` and, unless it passed, a
  `reason`. A frozen receipt therefore attributes each result to its
  scenario even after later reseeds. `scenario` is always written by
  `app-verify` 1.0.0 and optional for readers. Optional `attachments` lists extra files the
  step wrote into its capture directory, such as an exact simulator frame;
  `handoff` freezes them with the rest of the verified set.
- `restarts` is optional.
- `inputs` is optional: the run's inputs, written by `app-verify` 1.1
  whenever the plug-in declares any (`{}` when none was given). Each name
  is a letter followed by up to 63 letters, digits, `_` or `-` and never
  matches `/token|secret|password|credential|key/i`; each value is 1 to 512
  printable ASCII characters.
- `owned.endpoints` is optional: the extra endpoints the ready line named, as
  `{name: "http://127.0.0.1:<port>/"}`, written by 1.1 only when there are any.
- A reader ignores fields it does not know, so a later `app-verification/1`
  minor version can add optional fields without breaking older readers.
`roots` names the two storage roots: `<canonical checkout>` is the repository's
main worktree named by `repository`, and `~` is the owning Linux user's home.
`owned.runtimeDir` and `owned.proofDir` are directory names under those roots,
and capture paths are relative to `proofDir`. The receipt never contains a
token, a credential file path, an agent transcript or a session id.

### Storage and ownership

| What | Where | Why |
| --- | --- | --- |
| Proof | `<owning canonical checkout>/.local/evidence/verify/<run-id>/` | Survives worktree removal; the SDLC already keeps evidence there. A worktree's adapter resolves the canonical checkout through the repository's main worktree, never its own path |
| Runtime state | `~/.local/state/app-verify/<run-id>/` | Outside every Git checkout, as the hub's `private-path-in-checkout` rule and Pixoo's `PIXOO_DATA_DIR` rule require; on ext4, not the 7.6 GB `/tmp` tmpfs; short enough for Unix socket paths. The app's `TMPDIR` is `<run-id>/tmp`, because the wall demo uses `tempfile`, and its `HOME` is `<run-id>/home`, so the app never reads the caller's personal files unless its plug-in explicitly opts out |
| Synthetic fixtures | The adapter's own test fixtures in its repository | Scenarios version with the source; no shared fixture package |
| Ports | Bind `127.0.0.1:0`; read the actual port, and any extra endpoint's, from the application's readiness output | Two runs never race for a fixed port. The installed ports (8788, 8765, 8787, 8791, 41230, 41231; the last two lie inside Linux's ephemeral range) and any the adapter adds are refused: a run announcing one, as its URL or an endpoint, fails with `port-reserved` |
| Secrets | Run-generated credentials only, written `0600` inside the runtime directory and deleted with it | Installed `host.json` tokens are never read or copied |

The `reset` in `handoff --reset` and the `scenario` operation change only the
run's runtime directory. They cannot touch another run, the installed services'
state or the frozen set. The confined standalone qualification runner
(`scripts/performance/standalone.py`) is not reused: its bubblewrap sandbox
dies with the runner, which is right for a measurement and wrong for a preview
that must outlive the agent and be reachable from Windows.

### Supervisor and lease

Each run is a transient systemd user unit,
`app-verify-<run-id>.service`, started with `systemd-run --user --unit=<name>
--collect --property=KillMode=control-group --property=TimeoutStopSec=10s`,
with the application's stdout and stderr appended to files in the runtime
directory. Its lease is a transient realtime timer,
`app-verify-<run-id>-lease.timer`, created with `--on-calendar=@<expiresAt as
Unix seconds>` and `AccuracySec=1s`, whose service runs `systemctl --user stop
app-verify-<run-id>.service`. `start` and `extend` read the timer's
`NextElapseUSecRealtime` back and require it to equal the receipt's
`preview.expiresAt`, so the recorded expiry is verified rather than computed.
A wall-clock timer also elapses at that time after the host sleeps, where a
monotonic `--on-active` timer would run late. A transient timer unloads itself
after it fires. This gives:

- a lifetime independent of the agent session: the unit's parent is the user
  manager and its control group is under `user@<uid>.service/app.slice`, not
  the session that ran `start`;
- exact ownership: `stop` names the unit, and systemd kills every process in
  its control group, including helpers that called `setsid`; nothing is killed
  by port, process name or a remembered PID, so an expired lease cannot hit a
  reused PID or another run;
- observable expiry: `systemctl --user list-timers 'app-verify-*'` and `doctor`
  show the next elapse;
- extension by replacement: `RuntimeMaxSec` cannot be changed on a running unit
  (systemd 259 refuses `set-property`), so `extend` starts the next timer,
  `app-verify-<run-id>-lease-<k>.timer`, verifies it, then stops the old one,
  and records the new expiry. Making the new lease before breaking the old one
  means a run is never without a lease, even if `extend` is killed halfway;
- identity that survives PID reuse: `doctor` compares the receipt's unit name,
  `MainPID` and `ExecMainStartTimestampMonotonic` with the live unit before it
  reports `running`. A matching PID with a different start timestamp is
  `stale`;
- concurrency by name: `systemd-run` refuses a unit name that already exists,
  so two `start` calls cannot share an identity.

A run therefore lives at most as long as the user manager,
`user@<uid>.service`. On this PC that manager is wanted by the WSL
distribution's implicit login session and linger is off, so today the bound is
the distribution's lifetime; whether the distribution stays up when every
terminal closes, and whether linger is enabled, are
[ADR 0008](decisions/0008-runtime-hosting.md) matters that this contract does
not settle. The E2 probe showed the unit's placement outside the calling
session. The Hub adapter's `apps/hub/verify/tests/runs.test.mjs` supplies the
stand-in for an agent's exit: the wrapper runs inside its own transient scope,
and the scope is then stopped, killing everything the "agent" started. The
run's unit stays under `user@<uid>.service/app.slice` and `doctor` still
reports it `running` with health passed. What remains open is the user
manager's own lifetime without linger and the WSL distribution's lifetime,
listed below under ADR 0008. The core reads the output of
`systemctl --user is-system-running`, not its exit status: `running` and
`degraded` (common on WSL, where a failed browser scope degrades the manager
and the command exits 1) mean a usable manager, as do `starting` and
`initializing`, which already accept units. Anything else is
unavailable: `start` reports `supervisor-unavailable`, exits 3 and creates
nothing; the contract offers no nohup fallback because it could not honor the
cleanup rules.

### Browser session and secrets

- **Hub**: the run's configuration sets `browserAccess: "trusted-loopback"`,
  the owner's accepted same-PC sign-in
  ([#276](https://github.com/jimmie-potts/agent-device-hub/issues/276)). The
  preview URL is the plain loopback origin; the page signs itself in on load
  with a read and control session, no token appears in any URL, card, log or
  receipt, and the session cannot ingest, administer or use MCP. The
  disposable run holds only synthetic data and fake controllers, so the
  protection this option removes guards nothing real. For API assertions the
  adapter uses a run-generated credential from the runtime directory. The
  launcher path (`cli.js open`) is not used, because its one-time code would
  put a secret in the URL that the card prints.
- **Nanoleaf wall demo**: no sign-in exists. Writes carry a per-process page
  token in a header, which is not a secret to keep out of proof.
- **Pixoo**: no sign-in exists. `PIXOO_MODE=simulator` is set explicitly,
  because the current source accepts `device` too, and readiness reads
  `/api/health` to confirm the selected mode before the run is `running`.

Capture masks nothing. Scenarios therefore use only synthetic values and
run-generated credentials, and a configured token is never loaded into a page.

### Frozen proof

`handoff` moves every `capture-<n>/` taken so far into `verified.partial/`,
writes a copy of the receipt there whose capture paths already name their
`verified/` locations, writes `SHA256SUMS` over exactly that directory,
removes write permission from it recursively, records the manifest digest in a
`frozen` event, renames it to `verified/` and records `proof.frozenAt`. Only a
complete, summed set is ever named `verified/`.

A handoff killed before the rename leaves `verified.partial/`. The next
`handoff` moves its captures back and rebuilds. `stop` of a run that was never
frozen first removes its units, timers and runtime directory, then recovers
its proof under the receipt lock. It commits a complete own set as below,
moves other captures back so nothing is stranded, or reports a conflict
without undoing the cleanup.

A handoff killed after the rename but before the receipt records the freeze
leaves a `verified/` that no receipt has committed. The next `handoff`
commits it, keeping its original `frozenAt`, only when all of these hold:

- its `SHA256SUMS` digest and time equal this run's latest `frozen` event;
- its files match the manifest;
- its receipt copy is valid, is this run's (same run id and start time), and
  every frozen capture record in it equals the live one apart from the
  `verified/` prefix.

The commit is recorded as a `frozen-committed` event carrying the original
digest, never as a second `frozen` event. If this run took a capture after
that set was built, the set is this run's own, so `handoff` moves it back and
rebuilds it with the new capture. Any other mismatch (a rewritten manifest or
copy, a foreign set, a set without `SHA256SUMS`) refuses with
`proof-conflict`, changes nothing and leaves the files for inspection. Until
the retry `doctor` reports `proof: partial` when it would finish and
`conflict` when it would refuse, never `tampered`.
The live `receipt.json` and `events.jsonl` stay outside `verified/` and keep
changing with lease and cleanup fields; a `capture` after handoff writes under
`after-handoff/` and is labelled `set: after-handoff` in the receipt, so it can
never be mistaken for the verified set. The frozen set holds regular files
only. `doctor` compares `SHA256SUMS` with the manifest digest recorded in the
`frozen` event, verifies the sums, and reports `tampered` for a changed file,
manifest or entry type, `missing` when a frozen run's `verified/` or
`SHA256SUMS` is gone and `unreadable` when a proof file cannot be read, on that
run's row only; otherwise it reports `ok`. Manual exploration through the
browser writes nothing under the proof directory because the application never
knows it exists. A `restart` creates a new proof directory.

### Preview identity and staleness

The preview card names the run id, candidate, scenario, expiry and the exact
port, and `doctor <run-id>` answers the same for a link found later. The link
itself cannot display expiry: the applications own their pages, the dashboard
reads a fragment as a page route or a launch code, and the hub refuses query
strings on its page and dashboard routes. After expiry or `stop` the port answers nothing, so
a stale link fails to connect instead of showing old content. That is the
supported staleness signal; an in-page banner is deferred until an adapter
owns the page it would appear on.

## Failure behavior the adapters must implement

| Situation | Behavior |
| --- | --- |
| Concurrent runs | Distinct run ids, unit names, ports and directories; `doctor` lists all; no shared state |
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
| Runtime | The runtime through its own entry (`runMain`) with `--simulate`, `--edge` and the run's state directory, its SDK edge, and the supervisor's harness API; the preview links the runtime's health page | The fixture modules (the stand-in core, lamp and chime), `SimulatedLamps` and `SimulatedChime` reached over the runtime child's IPC channel, and the scenario's remote parts with run-generated grants | `simulated-transports`, `no-outbound-connections` and `private-state`: the runtime says it ran with `--simulate`; a guard loaded through `NODE_OPTIONS` into the runtime, the worker threads and Node processes that inherit its environment refuses each outbound TCP connection (`net`, `tls`, `http`, `https`, `fetch`) and UDP datagram (`dgram`) before anything leaves; and the run observes the runtime's home inside the run, nothing under its default state directory and every database it has open in the run's state directory. The guard does not cover a native addon, a non-Node binary, a process started with `NODE_OPTIONS` cleared, or a `node:dns` lookup. Tests start a run across each boundary and show its check fails |

## Caller walkthrough

The commands below use the Hub adapter's wrapper,
[`npm run -s verify --`](../apps/hub/verify/README.md); `-s` keeps npm's banner
off stdout, so it carries only the JSON result line. Each caller sees only
documented entrypoints.

### Agent: verify, retain proof, hand off

1. `npm run -s verify -- start --scenario lifecycle-basic` prints
   `{"runId":"hub-…","state":"running","port":41705,"build":{"dirty":false,…}}`.
2. `npm run -s verify -- capture hub-… task-appears` drives the page, asserts the
   session card and writes `capture-1/after.png` and
   `capture-1/interaction.webm`, which handoff later moves under `verified/`.
   A failed assertion returns non-zero and the PNG of the failure.
3. `npm run -s verify -- capture hub-… command-reaches-fake` asserts the fake
   controller received exactly one command and read-only browsing sent none.
4. `npm run -s verify -- handoff hub-… --reset lifecycle-basic` freezes
   `.local/evidence/verify/hub-…/verified/`, reseeds the run and prints the card:

   ```text
   Preview   http://127.0.0.1:41705/   run hub-20260927T060259Z-3f9a1c
   Candidate 4adfbf48 (clean)   scenario lifecycle-basic
   Expires   2026-09-27 08:02:59Z (in 1 h 58 min)
   Extend    npm run -s verify -- extend hub-20260927T060259Z-3f9a1c
   Stop      npm run -s verify -- stop hub-20260927T060259Z-3f9a1c
   Proof     task-appears verified/capture-1/after.png http://127.0.0.1:41705/__app-verify/proof/hub-20260927T060259Z-3f9a1c/capture-1/after.png
   Proof     task-appears verified/capture-1/interaction.webm http://127.0.0.1:41705/__app-verify/proof/hub-20260927T060259Z-3f9a1c/capture-1/interaction.webm
   ```

5. Link the screenshot and video URLs from the handoff's `proofUrls`, include
   the preview card, and attach those same frozen files when the chat client
   supports attachments. Do not rely on a filesystem or `file://` link alone:
   some chat clients cannot open it. State whether attachments were actually
   included. The HTTP links use the preview's existing loopback origin and
   work only while its lease is active; the user manager keeps the preview
   running after the agent session ends. Stop or expiry closes both preview
   and proof access. Also name the retained `verified/capture-<n>/` paths for
   later use: those files survive stop with their checksums unchanged.

The Hub opts into app-verify 1.2 proof serving. Only passed frozen captures
are exposed; private state, live receipts, failed captures and later captures
have no proof URL. PNG/JPEG and WebM/MP4 display in the browser; other allowed
attachments download. Reads refuse tampering and symlinks, with a 128 MiB
artifact limit. No directory index or separate proof service is created.
Adapters pinned to earlier versions retain their existing handoff: attach
their frozen files where supported and state that HTTP proof links are not
available for that adapter.

### Human: explore, extend, let it expire or stop

1. Open the card's URL in the Windows browser. The page signs in on load.
2. Explore. Nothing the human does writes under the proof directory.
3. `npm run -s verify -- extend hub-…` adds two more hours and prints the new
   expiry; `npm run -s verify -- doctor` lists the run with its remaining time.
4. After expiry the tab fails to reload. `npm run -s verify -- doctor hub-…`
   answers `expired` with the expiry time; `npm run -s verify -- stop hub-…`
   removes the runtime directory and records `cleanup.result: clean`.

### Restart later

`npm run -s verify -- restart hub-…` records the old run id in the new receipt,
reseeds the same scenario and prints a new card. If the working tree changed
since the first run, the card says `dirty` or shows the new revision; it never
claims to be the same candidate.

### Failed start

After `npm ci`, if the Hub wrapper's verification core has not been built,
`npm run -s verify -- start` prints one JSON result with `state: unavailable`
and `error: core-build-missing`, then exits 3. Its detail tells the caller to
run `npm run build` from the repository root. No preview is created.

`start` on a checkout whose build is broken reports
`{"state":"failed","cause":"readiness-timeout","cleanup":{"result":"clean"}}`.
The unit is gone, no timer exists, and the runtime directory was removed even
when seeding had already happened. The proof directory stays with the `failed`
receipt and `events.jsonl`, so `doctor` lists the run as `failed` with its
cause; that record is the useful outcome of a failed start.

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
  (through `runCaptureStep`), and the Hub's `steps.test.mjs` (its seven
  fixture reference steps, including the three Hub #336 moment steps, under
  every seeded fault, and its two `control-*` steps) and `build.test.mjs`. The lifecycle and Hub run tests skip there with a printed
  reason and run on this PC.
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

Hub [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495)
composes one integrated preview from three ordinary runs: the Nanoleaf wall,
Pixoo and the Hub. The Hub owns only the orchestration,
[`apps/hub/verify/compose.mjs`](../apps/hub/verify/compose.mjs). Each run
starts through its own repository's adapter wrapper, in its own checkout and
toolchain, and keeps its own unit, lease, receipt and proof. The Hub is the
one agent-state owner. The wall and Pixoo consume its feed and serve the
controller APIs that the Hub calls through its per-device queues. Their device
transports stay simulated or refused, as in their standalone runs.
[ADR 0009](decisions/0009-app-verification-runs.md) decision 9 records the
choice.

```text
npm run -s verify:compose -- start --checkout nanoleaf=<abs> --checkout pixoo=<abs> [--lease <minutes>] [--unpinned] [--restarts <composition-id>]
npm run -s verify:compose -- doctor [<composition-id>]
npm run -s verify:compose -- capture <composition-id> <step>
npm run -s verify:compose -- inject <composition-id> consumer-loss|second-owner pixoo [--step <step>] [--thaw-after <seconds>]
npm run -s verify:compose -- reset <composition-id>
npm run -s verify:compose -- handoff <composition-id>
npm run -s verify:compose -- extend <composition-id> [--lease <minutes>]
npm run -s verify:compose -- stop <composition-id>
```

Each operation prints one JSON result line and uses the core's exit codes.
Exit 3 also covers an adapter wrapper that cannot run.

### Pinned sources

The manifest [`apps/hub/verify/compose.json`](../apps/hub/verify/compose.json)
lists the consumers, then the owner. For each service it names:

- the repository and app name;
- the exact commit;
- the core version;
- the scenario it must support;
- the wrapper's argv.

The Hub runs from the checkout that holds the orchestrator, so its pin is
`self`: that checkout's commit, recorded as it is. The consumers' checkouts
are given as absolute real paths.

Before anything is created, `start` checks each checkout's `HEAD` and tracked
changes against its pin. It also runs each wrapper's `help` to read the app
name, `coreVersion`, the scenario and the scenario's required inputs. A pin
that differs or a dirty checkout fails `identity-mismatch`, with no proof
directory, runtime directory or unit created. `--unpinned` allows the run,
but the composition then records `pinned: false`, and its card says
development only, not citable evidence.

### Start and pairing

Unless `APP_VERIFY_PROOF_ROOT` is set, the orchestrator gives every adapter the
Hub's proof root, so consumer receipts and events stay under the canonical Hub
checkout even when a consumer runs from a disposable checkout. Each composed
run's receipt then records `roots.proof` as that absolute path, not the
`<canonical checkout>` label.

`start` records each step in the composition before the next one runs:

1. The wall, then Pixoo, then the Hub start in their default standalone
   scenarios. A run's id is recorded as soon as its wrapper names it on
   stderr, before its start finishes.
2. The orchestrator generates one feed token and one controller token per
   consumer and writes them with mode 0600:
   - into the consumer's runtime directory as `hub-feed-token` and
     `hub-controller-token`;
   - into the Hub's runtime directory as `<consumer>-feed-token` and
     `<consumer>-controller-token`.

   They are never printed, recorded or passed as inputs.
3. Each consumer reseeds `hub-paired` with `--input hub-feed=<Hub origin>`
   and announces its `controller` endpoint.
4. The Hub reseeds `integrated` with four inputs:
   `--input nanoleaf-controller=…`, `nanoleaf-preview`, `pixoo-controller`
   and `pixoo-preview`. It runs the real `cli.js serve` with:
   - owner `verify-owner`;
   - consumers `dashboard`, `nanoleaf` and `pixoo`;
   - the feed credentials' digests;
   - the two controllers, `wall` and `pixel`;
   - `browserAccess: "trusted-loopback"`;
   - Places pointing Wall at the paired wall run.
5. Readiness waits up to 60 s for all of these:
   - the Hub's feed answers;
   - the Hub reads both controllers through the dashboard's versioned path
     (`/api/controllers/v1/<alias>/snapshot?apiVersion=1.1`) and reports both
     devices ready, so a device card the dashboard cannot load fails readiness;
   - each consumer's own state read (see below) reports its feed `current`
     at the Hub's revision;
   - each run's own `doctor` reports `running` with every read-only check
     passed.

Every run starts standalone because a caller-supplied credential file cannot
serve a run's first seed: the runtime directory does not exist before
`start`. For the same reason the core's `restart` of a paired run fails at
seed by design. To restart a composition, stop it and start a new one with
`--restarts <old id>`. The new record names the old one and says
`same-candidate` or `different-candidate`, as the core's `restart` does, and
the old composition must have `state: stopped` and `cleanup.result: clean` first, including after a failed start or reset. A `start` killed
midway leaves `state: starting`, and `stop` removes the runs it recorded.

A failure at any step stops only the runs the composition recorded, Hub
first and then the consumers in reverse start order. The composition then
reports `state: failed` with the cause, the service and each run's cleanup.
Examples of causes:

- `service-start-failed`: a run did not start;
- `pairing-failed`: a reseed failed or announced no controller, or an
  endpoint used an installed port;
- `readiness-timeout`: with every failing check named.

### The composition record

`<Hub proof root>/<composition-id>/composition.json`, with an append-only
`events.jsonl`, records:

- the manifest digest;
- `pinned`;
- per service: its repository, checkout, pin, revision, dirty flag, core
  version, scenario, run id, state, URL, endpoints, proof directory, expiry,
  failure and cleanup;
- readiness checks, captures and injections;
- the latest reset attempt, phase, affected service and start/finish times;
- the composition's own failure and cleanup.

The composition id is `compose-<UTC start>-<6 hex>`. The record never holds a
token. The checkout paths are local operating state that `doctor`, `extend`
and `stop` need.

- `doctor <id>` runs each run's `doctor` and the readiness checks, giving the
  pairing checks up to 8 s to settle after a recent change. It reports
  `degraded` with every failing check, for example a crashed consumer
  or a unit left frozen. When every lease has elapsed it reports `expired`,
  and `stop` then records each run as expired. Without an id it lists every
  composition.
- `capture <id> <step>` runs one of the reference steps `integrated-lifecycle`,
  `integrated-command` or `one-owner` and records its outcome. Any other Hub
  step is refused as a usage error before anything runs: the fixture steps
  would reseed the owner out of `integrated`, and the loss and second-owner
  steps need `inject`.
- `handoff <id>` freezes each run's verified set and prints one card with the
  three links. Use the separate `reset <id>` operation for an aggregate reset.
- `reset <id>` returns the three runs to their paired starting state using
  the ordered pause and reseed described below.
- `extend <id>` extends all three leases.
- `stop <id>` stops the Hub first, then the consumers. It thaws a frozen unit
  first and continues past a service it cannot stop. When a run's wrapper
  cannot run, it stops that run's unit and lease timers by their exact names
  and reports `partial`: the runtime directory and receipt wait for the
  run's own `stop`. It reports each cleanup as `clean`, `partial`, `unknown`
  or `none`. Only a clean stop is final; stopping again retries every run.
- A run whose own recorded candidate (`sourceRevision`, `dirty`) differs
  from what the pin check saw, because its checkout changed during `start`,
  fails a pinned start with `identity-mismatch` and marks an unpinned
  composition's service unpinned.

### Reset and interrupted operations

`reset <id>` requires the unchanged, clean recorded checkouts and a running
composition. It records `resetting` and clears earlier readiness before effects.
It writes a fresh private pause request for each consumer, then waits up to
15 seconds for both feeds to drain. Requests and acknowledgments name the run
and operation nonce; acknowledgments must also match the live unit's PID,
process start, receipt and current lease. An existing, unsafe, stale or invalid
control fails closed. The consumer pages and local controllers stay available.

Once both pauses are verified, compose reseeds the Hub's `integrated` scenario
with its recorded pairing inputs. After owner success, it writes one matching
release and reseeds that consumer `hub-paired`, then does the same for the other.
Only each consumer's stopped-process seed may consume its controls. The old
process never resumes against the new owner's lower revision. Completion
requires the ordinary composition readiness checks to pass again. Run ids,
ports, pairing tokens, leases and frozen proof remain unchanged; reset does not
extend a lease or freeze new captures. Use `handoff` to freeze captures first.

A failure records `reset-failed`, the phase (`pause`, `owner`, `consumer` or
`readiness`), the service where known, and each returned service state. A
consumer awaiting drain is `pause-pending`; a verified drained consumer is
`paused`; an interrupted reseed remains `resetting` or `unknown` until diagnosed
or stopped. Remaining pauses stay in place. `doctor` exposes an incomplete reset
without treating old readiness as current. Use `stop <id>` to clean every run
owner-first before starting a replacement; do not remove controls to resume an
unreseeded process.

Operations on one composition serialize, including doctor's live probes.
Contention waits up to 10 seconds, then reports `composition-locked` for retry.
A wrapper runs behind a service-specific lock held by its runner. Sibling
services within one aggregate command can run together, so a waiting Hub capture
does not prevent its Pixoo injection from answering. If compose exits, each
runner terminates the wrapper's process group before releasing its lock; a
runner scheduled after its parent died never starts the wrapper. A later
operation drains every service barrier before probing or cleaning. An unkillable process
keeps cleanup blocked rather than permitting a competing reseed. This protects
ordinary aggregate operations and compose interruption; it does not coordinate
direct per-run commands or hostile same-user process/control replacement.

### Cross-service proof and loss

The Hub's `integrated` capture steps drive the Hub dashboard and, in the
same page and video, the paired runs' pages. Each consumer also answers
unauthenticated loopback reads for its feed revision and writer counts, and
[`apps/hub/verify/consumers.mjs`](../apps/hub/verify/consumers.mjs) reads
them for the steps and for readiness:

- the wall: `GET <wall URL>verify/state`, which reports its feed and the
  integration commands its writer applied;
- Pixoo: `GET <Pixoo URL>api/integration/v1/sessions`, its own view of the
  remote feed, and `GET <Pixoo URL>api/device/simulator`, the operations
  its simulator writer admitted and completed.

| Step | What it proves |
| --- | --- |
| `integrated-lifecycle` | A session posted to the Hub's real ingest route shows on the Hub card, as a question on a wall Line and on the Pixoo Monitor. Both consumers follow the Hub's revision, and no writer received a command. No link on the three pages leads to an installed service. The Hub's Places Wall link opens the paired wall run with the session, and the wall's B.U.N.N.Y. link opens the paired Hub's dashboard signed in with it, each in a new tab |
| `integrated-command` | One brightness change from the dashboard reaches Pixoo's writer exactly once. One Nanoleaf integration setting is applied once, with its physical outcome unknown. Nothing else reaches either writer |
| `one-owner` | A lifecycle event posted straight to the paired Pixoo, with the strongest Pixoo credential the composition holds, is not accepted. The Pixoo mirrors exactly the Hub's sessions at the Hub's revision, and its Monitor lists the Hub's session but not the direct one |
| `pixoo-loss` | Through `inject … consumer-loss pixoo`, as described below |
| `control-replay-after-recovery` | Negative control through `inject … consumer-loss pixoo --step control-replay-after-recovery`: the same loss, then a client re-sends the lost command as new work the moment the thawed Pixoo answers. It must fail at "nothing but the loss-time command reached a writer, and that at most once" |
| `control-second-owner` | Negative control through `inject … second-owner pixoo`: the orchestrator reseeds the Pixoo run to its standalone scenario, its own embedded owner, then restores `hub-paired`. The one-owner checks run in between and must fail at "the Pixoo reads its sessions only from the Hub: current at the owner's revision, with exactly the Hub's sessions" |

Only the delivery composition's runs, with the reference steps in their
verified sets, are delivery receipts. The runs of a separate controls
composition prove that the controls hold, and are never cited as delivery
receipts.

A control holds only when it fails at its named assertion. `compose` records
the expected assertion and whether the control held, and exits 0 only for a
held control. A control that passes, or fails anywhere else, exits 1. Run the
controls in a separate composition, or after `handoff` so the verified sets
hold only passed captures; a separate composition keeps them from freezing or
reseeding a Pixoo the owner is already looking at.

"Follows the Hub" means the consumer's feed is `current`, names the owner
`verify-owner`, has applied the Hub's revision and, for Pixoo, lists exactly
the Hub's sessions. The owner name alone proves nothing: Pixoo's embedded
owner uses it too. Readiness and the steps use the same rule.

`inject <id> consumer-loss pixoo` runs the loss step through a handshake.
The step asks for `freeze` and later `thaw` through two files in the Hub
run's runtime directory. The orchestrator applies each request to the unit it
recorded for Pixoo with `systemctl --user freeze` or `thaw` and reads
`FreezerState` back. The step never names a unit. Whatever the step does,
even if its wrapper dies, the orchestrator thaws the unit (or reseeds a
second owner back), removes the files, records the injection and prints one
result line; a capture that ended without a result exits 3.

systemd 259 refuses to stop a frozen unit ("Cannot perform operation on
frozen unit"), so its one-shot lease can fire without stopping it. Before
each freeze the orchestrator arms a safety thaw: a transient timer under the
user manager, `app-verify-<run-id>-thaw.timer`, that runs after
`--thaw-after` seconds (60 to 600, default 120). A freeze is refused when
that timer cannot be armed, or when the consumer's current per-run receipt
and armed lease timer cannot verify enough time for the safety thaw plus
the loss step's 180 s budget. This check runs both before injection and when
the step requests the freeze. Extend the composition first if it is refused.

A per-run lease can change independently of the composition, even during a
freeze. Every thaw path therefore thaws first, then checks the current receipt
and its named lease timer. If the lease expired or cannot be verified, it
stops that exact owned unit and reads back the result. This also applies when
the orchestrator dies and the safety timer performs the thaw. The receipt and
runtime directory remain for the run's ordinary `stop` cleanup.

If the safety timer thaws before the step requests it, the injection records
`thawedBy: "safety-timer"` and fails; it cannot claim the step's full loss window.
`stop` thaws before stopping and disarms each recorded run's safety thaw timer
and service after the adapter stops the run. Unverified cleanup is never
reported as clean. `doctor` reports a unit that is still frozen.

The step asserts:

- The dashboard shows the Pixoo `Stale / unavailable` and offers no
  brightness change.
- The Hub's health reports it unavailable.
- A client that read the Pixoo before the loss sends one command during it,
  and the Hub answers `uncertain-result`.
- The owner's revision moves past the Pixoo's last applied one.
- The step leaves the dashboard before the thaw, so its own read is the first
  Hub read of the recovered Pixoo. The dashboard then shows the Pixoo
  current, and both consumers follow the owner again.
- Nothing but the loss-time command reached a writer, and that at most once.
  Every writer counter of both consumers is compared. A delivered brightness
  command must carry the loss-time request id and its unique percent, and it
  must have taken effect before the Pixoo answered that first read. After
  that read, the request could only arrive as a re-send.
- Nothing more reaches a writer in the following seconds.

Why at most once rather than never: the kernel of a frozen process still
accepts the Hub's TCP connection, so the Pixoo may take that one request as
the first thing it does after the thaw. The step attaches
`loss-command.json` with the request id, the percent, the first read after
the thaw and whether 0 or 1 arrived. After the step, `inject` re-runs
readiness, and the injection record keeps the freeze and thaw times, the
capture and the recovery checks.

In an integrated preview, no link on the three paired pages leads to an
installed service: the Hub's Places come from `placeLinks`, and the wall's
`hub-paired` run points its B.U.N.N.Y. link at the paired Hub
(codex-nanoleaf#197). `integrated-lifecycle` asserts both. It also clicks
both links, because an `href` alone does not show that the page opens
([#561](https://github.com/jimmie-potts/agent-device-hub/issues/561)). Each
link opens a new tab. The navigation must be answered 200, and the tab must
show the wall with the step's session or the Hub's dashboard signed in with
it. The tab's screenshot is attached as `wall-from-hub.png` or
`hub-from-wall.png`, and the capture's assertion log notes each navigation's
`Sec-Fetch-Site` and status. The tab's own video is discarded, so the
capture keeps one video. Standalone consumer runs are out of this scope and
keep their own links.

A composition is simulated integration evidence only. It is not
installed-system acceptance or physical-device evidence. It is not a Windows
browser result either;
[#497](https://github.com/jimmie-potts/agent-device-hub/issues/497) qualifies
that.

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
explicit `--unpinned` option still labels development-only evidence. Separate
concurrent previews use separate worktrees and build outputs, including both
consumer checkouts for each composition. One coordinator controls each run;
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
locale, user-bus/runtime paths, owned temporary storage, shared npm/Playwright cache paths and explicit
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
