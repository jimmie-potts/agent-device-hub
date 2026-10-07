# Runtime verification runs

The runtime adapter ([#920](https://github.com/jimmie-potts/agent-device-hub/issues/920)) for the
[app verification contract](../../../docs/app-verification.md). The lifecycle comes from
[`@jimmie-potts/app-verify`](../../../packages/app-verify/README.md), unchanged. This directory supplies the plug-in
([`plugin.ts`](plugin.ts)), the process each run serves ([`supervisor.ts`](supervisor.ts)), the runtime child it
forks ([`child.ts`](child.ts)) and the run adapter of the scenario catalog ([`adapter.ts`](adapter.ts)). It is
built into `apps/runtime/dist/verify/` with the runtime.

A run serves the runtime from the checkout on the WSL host, with synthetic data and simulated devices:

| Part | Kind | What it is |
| --- | --- | --- |
| Runtime | actual | The runtime through its own entry (`runMain`) with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans` and the run's state directory, and `--config` for a configured scenario: the shipped module list, or the fixture modules |
| SDK edge | actual | The runtime's edge on its listener; each part has a run-generated grant in the state directory's `edge-grants.json` |
| Configuration | synthetic | For a scenario whose seed configures modules (#919), `<data>/config/runtime-config.json` and one token file per module under `<data>/config/secrets/`, all owner-only, holding the synthetic token `tok_SYNTHETIC919` |
| Fixture modules | simulated | The core (#831), with stand-in parts for history and the inbox until #782 and #923, the fixture lamp, chime and configured sign, and a harness module that reports what the bus publishes |
| Devices | simulated | `SimulatedLamps`, `SimulatedChime` and `SimulatedSigns`, held by the supervisor and reached over the runtime child's IPC channel, so they outlive a runtime crash as real devices would |
| Parts | simulated | The scenario's hook, operator, panel and reader: remote parts that the capture step connects to the edge |

The supervisor restarts a runtime that dies on its own, such as an armed crash between the lamp's commit and its
publish, on the same port and state directory, as the service manager would. It gives up and ends the run after five
such restarts within a minute. Starts and restarts run one after another, so overlapping restart requests never race
for the port. Its loopback harness API, the run's `harness` endpoint, drives the simulated devices and the run's
controls: hold, release, fail the next switch, fault the chime, arm a crash, lose an acknowledgment, end a part's
stream at the edge, and restart. It also reports the run's state: the devices, the runtime's log records and everything
its bus published, each with the runtime's generation, and it answers [one request's records and spans](#follow-one-request).
It answers only local JSON requests that name its listener, as the runtime's health does. Ending a stream takes only a
part's source, `bunny/parts/<role>`.

## Run scenarios

| Scenario | Starts |
| --- | --- |
| `fixtures` | The core with its stand-in parts, the lamp and the chime, for exploring (the default) |
| `shipped` | The runtime's own entry point with the shipped module list: the core alone, with no device module |
| one per catalog scenario, such as `end-to-end` | The modules that catalog scenario's seed names, with its configuration file when the seed has one: `configured-module` (a valid section, with the sign offline at first) and `misconfigured-module` (an invalid one, so health shows the sign `refused`) |
| `control-real-transports`, `control-installed-port`, `control-default-state` | Boundary negative controls; see below |

## Capture steps

| Step | What it does |
| --- | --- |
| `edge-grants` | A remote part with the run's reader grant syncs the core's sessions; one with a made-up token is `unauthenticated` |
| `scenario-<catalog id>` | Runs that catalog scenario through the run adapter on a freshly seeded run, attaches `scenario-result.json`, and expects every step to pass, every message to follow profile 2.0 and the boundaries to hold. The configured scenarios also expect the synthetic token in no log record, message, health entry or reader copy |
| `follow-one-request` | Follows one request through the run's diagnostics in four cases, then a killed runtime, an absent request and a capped query, and attaches each answer; see [below](#follow-one-request). Seeded fresh with the fixture modules |
| `control-scenario-fails` | A negative control, not a catalog scenario: it expects lamp-1 on though nothing switched it, so it must fail |
| `control-follow-fails` | A negative control: it expects the follow query to find a request that was never sent, so it must fail |

The run adapter implements the catalog's `Harness` in real time. Its parts are remote, so the per-transport
expectations are the remote ones, and every catalog scenario passes as it does in the in-memory harness. Its
`disconnect` has the runtime's edge end the part's stream, and the same remote part reconnects and hears of the gap,
as in the in-memory harness. The part's timers wait until the next `wait`, so it stays away for the steps in between. A
step's page shows the runtime's health document. The step loads it at its start and again at its end, so `after.png`
shows health as the step left it. There is no dashboard before #922.

## Follow one request

A run keeps two records of what its runtime did: the log records that the supervisor reads from the runtime's stderr, as
the service manager's journal would, and the spans, which the runtime writes to a bounded, private
[span file](../README.md#the-span-file) in its state directory. The harness's `GET /api/harness/v1/follow` reads both for
one request or one trace (Hub #950):

```bash
curl -s "<harness endpoint>api/harness/v1/follow?request=<request id>"
curl -s "<harness endpoint>api/harness/v1/follow?trace=<32 hex digits>&records=20&spans=20"
```

The `start` result and the preview card name the harness endpoint. Name exactly one of `request` and `trace`, and give
each of `request`, `trace`, `records` and `spans` at most once; each limit is a whole number from 1 to 100 and defaults to
50. A parameter the query does not know is ignored. A request or limit that is not valid, or a parameter given twice, is a
`400` with `invalid-request` and a fixed message, and the query never echoes it. The answer is JSON (`runtime-follow/1.0`):

| Field | What it says |
| --- | --- |
| `result` | `found`, or `none-found`: no record or span carries the ID, which says nothing of what happened. See `gaps` |
| `records` | The log records, each with the runtime that wrote it (`generation`), its level, event, trace and registered attributes |
| `spans` | The spans, with kind, status, duration, links and `parent`: `span` (kept), `caller` (the remote part's context, which the run does not record), `stored-message` (the context a stored message carried) or `missing` (not kept) |
| `decision` | How many commands the bus admitted (`admitted`), how many of them have no ending of their own (`unended`, so `ended` is true only when none lacks one), and the endings it recorded (`replied`, `refused`, `cancelled` or `uncertain`, with level and code). An ending belongs to the command with its message ID: a refusal for no responder, which is never admitted, ends no admitted command. `endings` lists at most as many as the `records` limit |
| `names` | How many matched spans have each name. A name no span has is not listed |
| `matched`, `omitted`, `traces`, `otherOnTrace` | What the query matched, what its limits left out (`omitted` counts records, spans and endings past the limits, and trace IDs past the 16 that `traces` names), the traces it touched, and what else those traces hold, such as another request's records |
| `searched` | How many records and spans it read and how many it could not, the runtimes the run has started, and the lowest level written |
| `gaps` | Each way the evidence can be incomplete, with its meaning, below |

A request ID takes only the records and spans that carry it, so another request on the same trace never leaks in; a trace
ID takes everything on it and the spans of other traces that link to it, such as a replay. Every record and span must pass
the diagnostic contract's validator, and the answer is built from the validated values alone: no payload, message or error
text reaches it, and a record or span the contract refuses is counted in `searched` and shown nowhere.

| Gap | Meaning |
| --- | --- |
| `generation-ended-without-stop` | A runtime ended without writing `runtime.stopped`, as after a crash or kill: its last records, its counts of lost telemetry and the spans it had not written are unknown |
| `telemetry-lost` | A runtime said at its stop that its queues or the contract refused this many records and spans |
| `losses-uncounted` | A runtime has not recorded its stop: while it runs, its losses are counted only when it stops, in `runtime.stopped`, and if it ended abruptly they are lost, so the records and spans that its queues dropped or its sinks lost are not shown. Every answer about the current runtime has this gap, whether it is live or was killed and not yet restarted |
| `spans-evicted`, `spans-eviction-unknown` | The span file keeps the latest spans (up to 1,024, at least 512 unless spans are large, since each segment also rotates at 2 MiB) and let this many go, or does not say, as after a runtime was killed between starting a segment and writing its header |
| `spans-truncated` | A span file was longer than its bound, so the read stopped |
| `spans-not-recorded`, `spans-unreadable` | The run has no span file, or it could not be read |
| `unreadable` | Journal lines that were not records, records the contract refused and spans that were not valid, counted and not shown |
| `parent-missing` | Spans continue a parent that is not kept: it was evicted, lost or never ended |
| `capped` | The query's limits left out records, spans or endings, or trace IDs past the 16 it names |

The `follow-one-request` step runs the cases against a freshly seeded run and attaches each answer as
`follow-<case>.json` in its capture directory: `success` (one trace, no span's parent missing, and no gap but the live runtime's `losses-uncounted`), `refusal` (the lamp
refused `lamp-9` with `not-found` at INFO, and no device call), `uncertain` (the device held the switch past the deadline:
`uncertain-result` at WARN, and the late outcome), `replayed` (a lost acknowledgment and a restart: one publication record,
two publish spans, the second a new root that links to the stored context, and the core's duplicate), `crash` (the
runtime was killed between the lamp's commit and its publish: no ending recorded, the runtime named, the spans that never
ended not reported, and the two that ended with their parents missing), `missing` (a request nothing carries), `capped`
(a query limited to two records and one span) and `trace` (the success by its trace ID). A reviewer can read one answer to
follow one command end to end, or run `scenario-end-to-end` and query any of its request IDs, such as `req-held`. The host
route runs only the core's operations, so a reviewer on it runs the step and reads the attached answers; one who can reach
the run's loopback harness queries it directly.

The harness's journal is what the supervisor read from the runtime's stderr: each line that is a JSON object with an
event name, and a count of every other line with content, such as a stack trace. The supervisor waits for a stopped
runtime's stderr to drain before it starts the next, so a clean stop shows its `runtime.stopped` record. Records below
`info` are not written, so a DEBUG observation, such as a duplicate that a consumer only counts, is absent by design.

## Boundaries

A run never reaches an installed service, a port of one, personal state or a device. Three checks prove it at `start`
and in `doctor`:

| Check | Passes when | Negative control | What crosses |
| --- | --- | --- | --- |
| `simulated-transports` | The runtime's `runtime.started` record says it built its modules with `--simulate` | `control-real-transports` | The shipped runtime runs without `--simulate` |
| `no-outbound-connections` | The guard refused no outbound TCP connection or UDP datagram; the runtime only listens | `control-installed-port` | A probe module reaches for the installed Hub's port 8788 with `fetch` and with `node:http`; the guard refuses both before they connect |
| `private-state` | What the run observes: the runtime's home, read from its environment, is private to the run; nothing exists under `<home>/.local/state`; every database the runtime has open is under `<data>/state`; and the grants file is owner-only | `control-default-state` | The runtime runs without `--state-dir`, so it creates its default directory under `<home>/.local/state`, which in a run lies under the run's private home |

The guard loads through `NODE_OPTIONS`, so it runs first in the runtime, in each worker thread that inherits its
environment (a file worker, as the runtime starts) and in every Node process it starts. It refuses every outbound TCP
connection made through `net`, `tls`, `http`, `https` or `fetch`, and every UDP send or connect through `dgram`, before
anything leaves. Each attempt goes to the run's `guard-report.jsonl`, which the check reads. A worker a module starts
through its context keeps the process's `NODE_OPTIONS` even when the module gives it its own `env` (#919), and a worker
call inherits the environment. The guard does not cover a native addon, a non-Node binary, a Node process or worker
thread started outside the module context with `NODE_OPTIONS` cleared or replaced, an `eval` worker, or a name lookup
through `node:dns`. The runtime uses none of these today.
A module story that adds a device transport adds its simulated one too.

The controls fail their start with `check-failed` by design, and are start-only: `scenario <run-id> <control>` and
`handoff <run-id> --reset <control>` are refused with `start-only-scenario` (exit 2) before anything changes. The
core already refuses a ready line on an installed service's port, and the supervisor gives the runtime a home inside
the run, so even a control never touches the owner's files.

## Entry points

Run at most one Acceptance run at a time on this host, because memory is the constraint
([docs/sdlc.md](../../../docs/sdlc.md#acceptance-review)). `npm run -s verify:runtime` refuses a second `start` with
`run-active` while any run is live ([one run at a time](../../../docs/app-verification.md#one-run-at-a-time)). Run with Node 24 from the repository root, and build first:
`start` serves the built candidate, and the `build-current` check fails a start whose sources are newer than the
build.

```bash
npm run build
npm run -s verify:runtime -- help
npm run -s verify:runtime -- start                                  # the fixture modules
npm run -s verify:runtime -- capture <run-id> scenario-end-to-end   # reseeds that scenario first
npm run -s verify:runtime -- capture <run-id> edge-grants
npm run -s verify:runtime -- capture <run-id> follow-one-request   # one request, case by case; answers attached
npm run -s verify:runtime -- scenario <run-id> zero-modules
npm run -s verify:runtime -- capture <run-id> scenario-zero-modules
npm run -s verify:runtime -- handoff <run-id>
npm run -s verify:runtime -- doctor
npm run -s verify:runtime -- stop <run-id>
```

To check a module's configuration as an operator would (#919), start a configured scenario and read health and the
runtime's records:

```bash
npm run -s verify:runtime -- start --scenario configured-module      # a valid section; the sign starts offline
npm run -s verify:runtime -- capture <run-id> scenario-configured-module
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- start --scenario misconfigured-module   # an invalid section; health shows the sign refused
npm run -s verify:runtime -- capture <run-id> scenario-misconfigured-module
npm run -s verify:runtime -- stop <run-id>
```

The configuration file and its token file are under `<runtime dir>/data/config/`. The token is synthetic, and no
health page, record or proof holds it.

The trusted host route runs the same operations as a transient user unit:
`npm run -s verify:host -- --host --app runtime --checkout <absolute checkout> -- <operation>`.

A reviewer can also use the run by hand. Its preview URL, which the card links, is the runtime's health page. The
same origin serves the SDK edge, which takes a remote part with a grant from
`<runtime dir>/data/state/edge-grants.json`. `start` never prints that grant.

## Checks

`npm run test:runtime:verify:built` judges every capture step through `runCaptureStep` on runs it starts without a user
manager, and starts each negative control. It tests the supervisor's stop, crash restart, restart serialization, orphan
handling and harness API, and the follow query: the supervisor's route, a clean restart and a killed runtime, and the
pure query's cases with their negative controls. It also tests the guard's reach in every thread and child process, and
that `build-current` watches every source the run loads.
Its lifecycle tests drive real transient units through the wrapper and skip with a printed reason where there is no
user manager (#873). See [Runtime verification runs](../../../docs/development.md#runtime-verification-runs).
