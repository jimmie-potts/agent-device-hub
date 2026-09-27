# App verification interface

Hub [#493](https://github.com/jimmie-potts/agent-device-hub/issues/493) defines
one small way for a delivery agent or the owner to start a disposable copy of an
application with synthetic data and simulated device transports, establish what
is running, exercise a scenario, keep proof, and hand over a preview that
expires. Hub is the first caller
([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494)); the
Nanoleaf wall ([codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193))
and Pixoo ([divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118))
adapters implement the same operations for their applications.
[ADR 0009](decisions/0009-app-verification-runs.md) records the lasting
decisions and their alternatives. The initiative and its accepted scope are in
[#488](https://github.com/jimmie-potts/agent-device-hub/issues/488).

This document is a contract for source work. Nothing here is installed. A run
never attaches to the installed services, personal state or physical devices. Actual Windows-host qualification belongs to
[#497](https://github.com/jimmie-potts/agent-device-hub/issues/497).

## Vocabulary

- **Run**: one disposable application instance with its own identity, state,
  port, supervisor unit and lease. `run-id` is
  `<app>-<UTC start, yyyymmddThhmmssZ>-<6 hex>`, for example
  `hub-20260927T060259Z-3f9a1c`.
- **Adapter**: the application's project-owned command that implements the
  operations below. Each project chooses its wrapper (`npm run verify --`,
  `python3 scripts/verify.py`); the operation names and receipt are shared.
- **Candidate**: the source revision and built artifact a run serves. A run
  always names its candidate, including when it is dirty or unknown.
- **Scenario**: a named, deterministic synthetic seed owned by the adapter's
  test fixtures. Its version is the candidate's source revision, because the
  fixtures live with the source.
- **Proof**: screenshots, video, receipts and check output captured while the
  agent verified the run. Proof is frozen at handoff and never changes again.
- **Preview**: the same run, or a reset copy of its state, left serving for a
  human to explore under a lease.
- **Lease**: the time after which the supervisor stops the run by itself.
  Default two hours; explicit `extend` and `stop`.
- **Owned resources**: the exact unit names, runtime directory, listener port
  and proof directory a run created. Cleanup touches only these.

## Operations

Every operation prints one JSON result line on stdout and progress on stderr.
No operation prints a token, a private path outside the receipt's two declared
roots, or personal data. Exit status 0 means the outcome was verified, not
merely requested.

| Operation | Outcome | Failure it must report |
| --- | --- | --- |
| `start [--scenario <name>] [--lease <minutes>]` | Creates the run's runtime directory, seeds the scenario, starts the application under its supervisor unit, waits for readiness, starts the lease timer and writes the first receipt with `state: running` | Occupied or unusable port, dirty or unknown build, readiness timeout, seed failure, supervisor unavailable. A failed start stops its unit, removes its runtime directory and reports `state: failed` with the cause and what was cleaned |
| `doctor [<run-id>]` | Reads live state without changing it: the unit's active state, main PID and start timestamp, the actual listener port and a loopback health read, the build identity the process reports or the receipt recorded, the lease timer's next elapse, and the proof directory's frozen state. Without an argument it lists every run of this app and flags runs whose unit is gone but whose receipt says `running` | A receipt that disagrees with the live unit is reported as `stale`, never repaired silently |
| `scenario <run-id> <name>` | Reseeds this run's disposable state to the named scenario while the run keeps its identity, port and lease. Only this run's runtime directory changes | A scenario the fixtures do not define; a run that is not `running` |
| `capture <run-id> <scenario-step>` | Drives the real page in the pinned Playwright Chromium against this run, asserts the step's expected observations, and writes a screenshot, a short video of the stateful interaction and the assertion log into a new `capture-<n>/` directory of the proof. Failed assertions are preserved as failures with their screenshot | Missing browser tooling, a crashed page, a video that was not finalized, an assertion failure. Each is a `capture.outcome` of `failed` or `unavailable` with the reason, never a successful-looking screenshot |
| `handoff <run-id> [--reset <scenario>]` | Freezes the proof (writes `SHA256SUMS`, marks the directory read-only, records `proof.frozenAt`), optionally reseeds the run's state so the human starts from known data, and prints the preview card: URL, run id, candidate, expiry, and how to extend or stop | A run whose proof is already frozen accepts another `handoff` only to print the card again; it never rewrites frozen proof. A reset that fails leaves the run stopped rather than serving half-seeded state |
| `extend <run-id> [--lease <minutes>]` | Replaces the lease timer with a new one and records the new expiry in the receipt and the printed card | A run whose unit is not active, or whose timer cannot be replaced, is reported as such; nothing else is touched |
| `stop <run-id>` | Stops the lease timer and the supervisor unit, verifies both are gone, removes the runtime directory, and writes the final receipt with `cleanup.result`. Frozen proof stays | A unit that will not stop within its timeout is reported with its unit name for the owner; the adapter never kills by port, process name or a remembered PID |
| `restart <run-id>` | `stop`, then `start` with the recorded scenario and candidate, producing a new run id whose receipt names the run it restarts | A changed working tree makes the new run a different candidate; the receipt says so instead of claiming continuity |

Expiry is not an operation. The lease timer stops the unit, and the next
`doctor` reports `state: expired`, the exact expiry time and that the runtime
directory is still to be removed by `stop`. Frozen proof is unaffected.

### Readiness and build identity

`start` succeeds only after a loopback read of the application's own readiness
route answers as expected: the hub's `{ready:true,url}` startup line and
`GET /api/hub/v1/health`; the wall demo's `{url}` startup line and its map page;
Pixoo's `GET /health` reporting simulator mode. The receipt's `build` uses the
field names the [install contract](https://github.com/jimmie-potts/agent-device-hub/issues/465)
fixes for running processes, so a later health field
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

One `receipt.json` per run under its proof directory, rewritten by each
operation that changes state, with an append-only `events.jsonl` beside it.
Fields, all required unless marked optional:

```json
{
  "receiptVersion": "app-verification/1",
  "runId": "hub-20260927T060259Z-3f9a1c",
  "app": "hub",
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
  "captures": [{"n": 1, "step": "task-appears", "outcome": "passed", "screenshot": "capture-1/after.png", "video": "capture-1/interaction.webm"}],
  "preview": {"url": "http://127.0.0.1:41705/", "expiresAt": "2026-09-27T08:02:59Z", "leaseMinutes": 120},
  "owned": {"unit": "app-verify-hub-20260927T060259Z-3f9a1c.service", "leaseTimer": "app-verify-hub-20260927T060259Z-3f9a1c-lease.timer", "port": 41705, "runtimeDir": "~/.local/state/app-verify/hub-20260927T060259Z-3f9a1c", "proofDir": ".local/evidence/verify/hub-20260927T060259Z-3f9a1c"},
  "proof": {"frozenAt": null},
  "cleanup": {"result": null},
  "secrets": "none recorded"
}
```

`state` is one of `starting`, `running`, `failed`, `expired`, `stopped`.
`cleanup.result` becomes `clean`, `partial` (with the resource left behind and
its identity) or `unknown` (the readback failed). `restarts` is optional. Paths
inside the receipt are relative to the two declared roots; the receipt never
contains a token, a credential file path, an agent transcript or a session id.

### Storage and ownership

| What | Where | Why |
| --- | --- | --- |
| Proof | `<owning canonical checkout>/.local/evidence/verify/<run-id>/` | Survives worktree removal; the SDLC already keeps evidence there. A worktree's adapter resolves the canonical checkout through the repository's main worktree, never its own path |
| Runtime state | `~/.local/state/app-verify/<run-id>/` | Outside every Git checkout, as the hub's `private-path-in-checkout` rule and Pixoo's `PIXOO_DATA_DIR` rule require; on ext4, not the 7.6 GB `/tmp` tmpfs; short enough for Unix socket paths. `TMPDIR` for the run points here too, because the wall demo uses `tempfile` |
| Synthetic fixtures | The adapter's own test fixtures in its repository | Scenarios version with the source; no shared fixture package |
| Ports | Bind `127.0.0.1:0`; read the actual port from the application's readiness output | Two runs never race for a fixed port and never touch the installed ports (8788, 8765, 8787, 8791, 41231) |
| Secrets | Run-generated credentials only, written `0600` inside the runtime directory and deleted with it | Installed `host.json` tokens are never read or copied |

The `reset` in `handoff --reset` and the `scenario` operation change only the
run's runtime directory. They cannot touch another run, the installed services'
state or frozen proof.

### Supervisor and lease

Each run is a transient systemd user unit,
`app-verify-<run-id>.service`, started with `systemd-run --user --unit=<name>
--collect --property=KillMode=control-group`. Its lease is a transient timer,
`app-verify-<run-id>-lease.timer`, created with `--on-active=<seconds>` whose
service runs `systemctl --user stop app-verify-<run-id>.service`. This gives:

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
  (systemd 259 refuses `set-property`), so `extend` stops the old timer and
  starts a new one, then records the new expiry;
- identity that survives PID reuse: `doctor` compares the receipt's unit name,
  `MainPID` and `ExecMainStartTimestampMonotonic` with the live unit before it
  reports `running`. A matching PID with a different start timestamp is
  `stale`;
- concurrency by name: `systemd-run` refuses a unit name that already exists,
  so two `start` calls cannot share an identity.

A run therefore lives at most as long as the WSL distribution. Whether the
distribution stays up when every terminal closes is the keep-alive trial in
[ADR 0008](decisions/0008-runtime-hosting.md), which this contract does not
settle. Without systemd (`systemctl --user is-system-running` fails) `start`
reports `supervisor unavailable` and does nothing; the contract offers no
nohup fallback because it could not honor the cleanup rules.

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
  `/health` to confirm the selected mode before the run is `running`.

Capture masks nothing. Scenarios therefore use only synthetic values and
run-generated credentials, and a configured token is never loaded into a page.

### Frozen proof

`handoff` writes `SHA256SUMS` over the proof directory, removes write
permission recursively and records `proof.frozenAt`. Later operations write
only new `capture-<n>/` directories, `events.jsonl` and `receipt.json` updates
for lease and cleanup fields; `doctor` verifies the sums and reports
`proof: tampered` when they no longer match. Manual exploration through the
browser writes nothing under the proof directory because the application never
knows it exists. A `restart` creates a new proof directory.

### Preview identity and staleness

The preview card names the run id, candidate, scenario, expiry and the exact
port, and `doctor <run-id>` answers the same for a link found later. The link
itself cannot display expiry: the applications own their pages, the dashboard
reads a fragment as a page route or a launch code, and the hub refuses query
strings on its routes. After expiry or `stop` the port answers nothing, so
a stale link fails to connect instead of showing old content. That is the
supported staleness signal; an in-page banner is deferred until an adapter
owns the page it would appear on.

## Failure behavior the adapters must implement

| Situation | Behavior |
| --- | --- |
| Concurrent runs | Distinct run ids, unit names, ports and directories; `doctor` lists all; no shared state |
| Occupied port | Never happens for the run's own listener, which binds port 0. A fixed-port dependency the application insists on is a `start` failure naming the port, not a retry loop |
| Stale build | `dirty` and `unknown` are labelled at `start`, in the card and in the receipt. Proof from a dirty run cannot be cited as a merge candidate's evidence |
| Interrupted start | The unit's failure kills the rest of its control group; `start` reports `failed`, removes the runtime directory and leaves no timer. A `start` interrupted before the unit exists leaves nothing |
| Agent exit | The unit and timer belong to the user manager; the run keeps serving until expiry or `stop`. The next session finds it with `doctor` |
| Stale process identity | Unit name, `MainPID` and start timestamp must all match the receipt, otherwise `stale`; cleanup goes through the unit, never a PID |
| Failed capture | Recorded as `failed` with the reason and whatever partial artifact exists; the run continues; the assertion failure is the result |
| Unavailable browser tooling | `capture` reports `unavailable` naming the missing piece (Playwright module, Chromium build, ffmpeg); `start`, `handoff`, `extend` and `stop` still work |
| Expired lease | Unit stopped by the timer; `doctor` shows `expired`; `stop` removes the runtime directory; proof unchanged |
| Runtime directory missing | `doctor` reports it; `stop` still stops the unit and records `cleanup.result: partial` |

## Actual and simulated components

| App | Actual | Simulated or synthetic | Boundary evidence the adapter must show |
| --- | --- | --- | --- |
| Hub | Hub service, B.U.N.N.Y. dashboard, browser sessions, command replay | Fake loopback controllers and Sony receiver from `apps/dashboard/tests/fixture.mjs`; synthetic lifecycle events | Controller writes are observed on the fake; read-only browsing writes no command |
| Nanoleaf wall | Wall server, map page, private SQLite state, allocation and Prism rendering | Worker stand-in (`scripts/demo.py` `prepare`), synthetic projects and tasks, fixture layouts | The demo's `request=no_device` trap raises on any light request; the adapter proves an attempted request fails |
| Pixoo | Fastify server, web UI, library, playlists, player | Simulator transport, synthetic media in a private `PIXOO_DATA_DIR` | `/health` reports simulator mode and no device connectivity; ambient `PIXOO_MODE=device` does not leak into the run |

## Caller walkthrough

The commands below use the Hub adapter's future wrapper name as an example;
#494 fixes the exact spelling. Each caller sees only documented entrypoints.

### Agent: verify, retain proof, hand off

1. `npm run verify -- start --scenario lifecycle-basic` prints
   `{"runId":"hub-…","state":"running","port":41705,"build":{"dirty":false,…}}`.
2. `npm run verify -- capture hub-… task-appears` drives the page, asserts the
   session card and writes `capture-1/after.png` and
   `capture-1/interaction.webm`. A failed assertion returns non-zero and the
   PNG of the failure.
3. `npm run verify -- capture hub-… command-reaches-fake` asserts the fake
   controller received exactly one command and read-only browsing sent none.
4. `npm run verify -- handoff hub-… --reset lifecycle-basic` freezes
   `.local/evidence/verify/hub-…/`, reseeds the run and prints the card:

   ```text
   Preview  http://127.0.0.1:41705/   run hub-20260927T060259Z-3f9a1c
   Candidate 4adfbf48 (clean)   scenario lifecycle-basic
   Expires  2026-09-27 08:02:59Z (in 1 h 58 min)
   Extend   npm run verify -- extend hub-20260927T060259Z-3f9a1c
   Stop     npm run verify -- stop hub-20260927T060259Z-3f9a1c
   ```

5. The agent's handoff message links the two capture files and the card. The
   agent session ends; the run keeps serving.

### Human: explore, extend, let it expire or stop

1. Open the card's URL in the Windows browser. The page signs in on load.
2. Explore. Nothing the human does writes under the proof directory.
3. `npm run verify -- extend hub-…` adds two more hours and prints the new
   expiry; `npm run verify -- doctor` lists the run with its remaining time.
4. After expiry the tab fails to reload. `npm run verify -- doctor hub-…`
   answers `expired` with the expiry time; `npm run verify -- stop hub-…`
   removes the runtime directory and records `cleanup.result: clean`.

### Restart later

`npm run verify -- restart hub-…` records the old run id in the new receipt,
reseeds the same scenario and prints a new card. If the working tree changed
since the first run, the card says `dirty` or shows the new revision; it never
claims to be the same candidate.

### Failed start

`start` on a checkout whose build is broken reports
`{"state":"failed","cause":"readiness-timeout","cleanup":{"result":"clean"}}`,
the unit is gone, no timer exists, and `doctor` lists nothing for that run id.
A start that failed after seeding removes its runtime directory as well.

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
- WSL distribution lifetime with no terminal open, which bounds every lease
  (ADR 0008 trial pending).
- Codex sandbox: this session ran from Claude Code, where Windows interop and
  `systemd-run` work. Earlier evidence shows Codex's sandbox refusing Windows
  interop; whether it can create user units is unknown until tried there.
- Preview behavior across Windows sleep and resume: unknown.

## Adapter acceptance

Each adapter proves these clauses in its own repository's checks, in addition
to its issue's acceptance list:

| Clause | #494 Hub | codex-nanoleaf#193 | divoom-app-upgrade#118 |
| --- | --- | --- | --- |
| Operations and receipt shape | All operations; receipt validated against the fields above | Same, using `demo.py` `prepare` as the seed | Same, wrapping the simulator entrypoint |
| Readiness and build identity | `{ready,url}` line, health, `/dashboard.js` digest, dirty flag | `{url}` line, map page read, dirty flag | `/health` selected mode, dirty flag |
| Supervisor, lease, extend, stop, expiry | Tests against a real transient unit with a short lease | Same | Same |
| Two concurrent runs share nothing | Two runs, two ports, independent reset | Same | Same, two `PIXOO_DATA_DIR`s |
| Failed start cleans up | Broken build or readiness timeout leaves no unit, timer or directory | Same | Same |
| Capture and failed capture | Screenshot and video of a stateful step; a known wrong result is reported as failed | Same for a task transition | Same for playlist progression |
| Frozen proof | Sums verified after a reset and a second capture | Same | Same |
| Secrets and session path | Trusted-loopback sign-in; no token in card, log or receipt; API assertions with a run-generated credential | Page token never printed | No credential exists; ambient `PIXOO_MODE=device` is overridden and proven by `/health` |
| Simulated boundary | Fake controller observed; read-only browsing writes nothing | Light request trap raises | No physical transport request |

The executable behavior these clauses describe arrives with those issues and
their issue-linked OpenSpec changes. This document adds no product behavior,
which is why #493 carries no OpenSpec delta.

## Deferred

No LAN or phone hosting, remote fleet, continuous preview service, in-page
expiry banner, physical-device accuracy or general process-management
platform. Revisit wider access only after #497 qualifies the same-PC path.
