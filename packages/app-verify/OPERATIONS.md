# App verification operation contract

This is the operation and receipt contract for the shared verification package.
[The caller guide](../../docs/app-verification.md) owns selecting an adapter and running the common workflow.

## Operations

Every operation prints one JSON result line on stdout and progress on stderr.
A refusal line that the core prints keeps its `error` and `detail` and also
carries `errorBody`, the shared 2.0 error body of
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md); the
[core README](#refusal-error-body) maps each
refusal to its registry code. Refusals that adapters and wrappers print
themselves keep their 1.x shape until
[#839](https://github.com/jimmie-potts/agent-device-hub/issues/839): the
CHOMPI adapter's `start-only-scenario`, the Hub composition's own usage,
failure and internal lines, the missing-build results of `scripts/verify.mjs`
and `scripts/verify-chompi.mjs`, and `scripts/verify-host.mjs`'s own refusals.
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
| `start [--scenario <name>] [--lease <minutes>] [--input <name>=<value>]...` | In this order: writes the proof directory with a `starting` receipt naming the unit, timer and runtime directory it is about to create; runs the adapter's optional build step; creates the runtime directory and seeds the scenario; starts the lease timer; starts the application under its supervisor unit; waits for readiness; runs the adapter's boundary checks; rewrites the receipt with `state: running`. The timer exists before the unit, so no running application is ever without a lease | Occupied or unusable port, dirty or unknown build, readiness timeout, seed failure, supervisor unavailable. A failed start stops its unit and timer, removes its runtime directory and reports `state: failed` with the cause and what was cleaned. A wrapper that opted in [refuses](../../docs/app-verification.md#one-run-at-a-time) a start while another run is live, with `run-active`, before it creates anything |
| `doctor [<run-id>]` | Reads live state without changing it: the unit's active state, main PID and start timestamp, the ports the unit's own processes listen on (from its control group and `ss`) against the recorded port, a loopback health read, the build identity the process reports or the receipt recorded, the lease timer's next elapse, the verified set's checksums, and any boundary check the adapter marks read-only. Without an argument it lists every run of this app discovered from the union of `app-verify-<app>-*` units and timers, runtime directories and receipts, so an orphan of any kind appears. A run whose unit is gone while its receipt says `running` or `starting` is `expired` when `preview.expiresAt` has passed and `stale` otherwise | A receipt that disagrees with the live unit is reported as `stale`, never repaired silently |
| `scenario <run-id> <name> [--input <name>=<value>]...` | Reseeds this run's disposable state to the named scenario while the run keeps its identity, port and lease: stops the application unit, empties its state, seeds, and relaunches it on the recorded port and endpoint ports. Each `--input` replaces that input's recorded value; the others are kept. Only this run's runtime directory changes | A scenario name the adapter does not define; a run that is not `running`. A reseed that fails after the application stopped ends like a failed reset below: `state: stopped`, `failure.cause: reset-failed` |
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

### One run at a time

[docs/sdlc.md](../../docs/sdlc.md#acceptance-review) allows one Acceptance run at a time
on a host, because memory is the limit.
[Hub #944](https://github.com/jimmie-potts/agent-device-hub/issues/944) lets a
wrapper enforce it. With `APP_VERIFY_SINGLE_RUN=1` in the environment of a
`start`, the core refuses while any run's service unit is live on this host,
whichever application started it:

```json
{"operation":"start","error":"run-active","detail":"run hub-20260927T060259Z-3f9a1c is still live on this host, and only one run may start at a time; stop it with the stop operation of the adapter that started it, or wait for the lease to end, then start again","errorBody":{"error":{"code":"capacity","retryable":true,"detail":"run-active: run hub-20260927T060259Z-3f9a1c is still live on this host, and only one run may start at a time; stop it with the stop operation of the adapter that started it, or wait for the lease to end, then start again"}}}
```

- The refusal exits 1, names the live runs, comes before anything is created
  and leaves the live run untouched. Its `errorBody` is `capacity`, retryable.
- The Hub's wrappers opt in through their package scripts: `verify`,
  `verify:compose`, `verify:chompi` and `verify:runtime`, and the
  [host route](../../docs/app-verification.md#explicit-host-route-for-codex-development-coordinators) sets it
  for the adapter it runs. The pinned Nanoleaf and Pixoo cores (1.1.0) do not
  read it, so `--app nanoleaf` and `--app pixoo` are not guarded. The test suites do not set it, so they keep starting
  runs side by side, and a wrapper started with `node scripts/verify.mjs`
  directly is not guarded. The Nanoleaf and Pixoo wrappers opt in the same way
  once they vendor a core that has this.
- A unit that is `active (running)` or `activating` counts. A failed, inactive
  or stopping unit, a lease or thaw timer or its service, and the host route's
  command unit do not, so a stale or failed unit never blocks a start. Any run
  counts, including another session's test runs: the core's short-lived
  `avt-<hex>` runs, the Hub, runtime and CHOMPI verify suites' runs under their
  apps' own names (`hub-…`, `runtime-…`, `chompi-…`), and a composition test's
  stand-ins (`<tag>-nl` and `<tag>-px`). They end by themselves within minutes,
  so a refused start waits and retries. A claim
  left by a killed start goes within about a second, and in any case after 30
  minutes. A release stops only the claim its start took; when it cannot read
  which one that is, it stops nothing and the claim ends with the starting
  process. A live
  unit with a stale receipt does count, because it still holds memory:
  `doctor` shows it and `stop <run-id>` ends it.
- A run has no unit until its build, seed and lease steps are done, so a guarded
  start first takes a claim, the transient unit `app-verify-start-claim.service`,
  that lives while the starting process does. `systemd-run` refuses a name that
  exists, so of two starts begun together one is refused, with `run-active`.
- `restart` is never refused. A composition counts as one run: `verify:compose`
  holds the claim for the whole composition, refuses beside any live run before
  it creates anything, and starts its three runs without the variable. Its
  refusal keeps the composition's own 1.x line, `{"operation", "error":
  "run-active", "detail"}`.

The [core README](README.md#one-run-at-a-time) has the
details.

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
[ADR 0008](../../docs/decisions/0008-runtime-hosting.md) matters that this contract does
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


## CLI result reference

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
`{"operation", "error", "detail"}` and the shared `errorBody` (see
[Refusal error body](#refusal-error-body)), for example `run-not-running`, or
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

### Refusal error body

Every refusal line also carries `errorBody`, the shared 2.0 error body of
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md)
([Hub #921](https://github.com/jimmie-potts/agent-device-hub/issues/921)). It
sits beside the 1.x `error` and `detail`, which do not change:

```json
{"operation":"extend","error":"run-not-running","detail":"hub-20260927T060259Z-3f9a1c is stopped","errorBody":{"error":{"code":"invalid-state","retryable":false,"detail":"run-not-running: hub-20260927T060259Z-3f9a1c is stopped"}}}
```

A refusal line is one that prints `error`: the `{"operation", "error",
"detail"}` line above, and a `stop` that reports `receipt-locked` with its
cleanup, which `restart` passes on. Failed outcomes, such as a `start` with
`state: failed` and a `cause`, are unchanged. Receipts stay
`app-verification/1`, and the exit codes stay the same.

- `code` is the registry code for the 1.x refusal in the table below, and
  `retryable` is that code's registry flag.
- `detail` is `<error>: <detail>`, cut to 1024 characters, so the body still
  names the 1.x refusal.
- The package still has no runtime dependencies. It copies the registry codes
  it uses and their flags from `@jimmie-potts/event-contracts`, and
  `tests/error-body.test.mjs` checks that each body equals that package's
  `errorBody`. In an isolated consumer, where that package is not installed,
  the check skips with a printed reason.

When 1.x retires ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)),
a refusal line becomes `{"operation", "error": {"code", "retryable", "detail"}}`:
the string `error`, the 1.x `detail` and `errorBody` are removed, and `error`
holds the body that `errorBody` holds now.

| 1.x `error` | 2.0 `code` | Retryable |
| --- | --- | --- |
| `usage` | `invalid-request` | no |
| `unknown-scenario` | `invalid-request` | no |
| `unknown-run` | `not-found` | no |
| `invalid-receipt` | `invalid-state` | no |
| `run-not-running` | `invalid-state` | no |
| `scenario-mismatch` | `invalid-state` | no |
| `already-frozen` | `invalid-state` | no |
| `proof-conflict` | `invalid-state` | no |
| `proof-irregular` | `invalid-state` | no |
| `proof-root-unusable` | `invalid-state` | no |
| `runtime-root-unusable` | `invalid-state` | no |
| `capture-in-progress` | `capacity` | yes |
| `receipt-locked` | `capacity` | yes |
| `run-active` | `capacity` | yes |
| `lease-failed` | `unavailable` | yes |
| `internal` | `internal` | no |
| Any other | `internal` | no |
