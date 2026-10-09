# Composed legacy previews

These procedures concern the retained legacy system. Current runtime work starts
at [the runtime guide](../../runtime/README.md). They authorize no installed-service or device changes.

## Composed previews

Hub [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495)
composes one integrated preview from three ordinary runs: the Nanoleaf wall,
Pixoo and the Hub. The Hub owns only the orchestration,
[`apps/hub/verify/compose.mjs`](compose.mjs). Each run
starts through its own repository's adapter wrapper, in its own checkout and
toolchain, and keeps its own unit, lease, receipt and proof. The Hub is the
one agent-state owner. The wall and Pixoo consume its feed and serve the
controller APIs that the Hub calls through its per-device queues. Their device
transports stay simulated or refused, as in their standalone runs.
[ADR 0009](../../../docs/decisions/0009-app-verification-runs.md) decision 9 records the
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

The manifest [`apps/hub/verify/compose.json`](compose.json)
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

A composition counts as one run for the [one-run guard](../../../docs/app-verification.md#one-run-at-a-time):
`verify:compose start` refuses with `run-active` while any run is live on the
host, and starts its three runs without the variable. The pinned Nanoleaf and
Pixoo cores (1.1.0) do not read it; the Hub's own wrapper does, and would
refuse for the two consumers before it.

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
[`apps/hub/verify/consumers.mjs`](consumers.mjs) reads
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
controls after `handoff`, so the verified sets hold only passed captures, or in
a separate composition started once the first has stopped
([one run at a time](../../../docs/app-verification.md#one-run-at-a-time)), whose runs are never cited as
delivery receipts.

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
