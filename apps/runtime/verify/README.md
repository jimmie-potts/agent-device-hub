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
| Runtime | actual | The runtime through its own entry (`runMain`) with `--simulate`, `--edge`, `--environment test` and the run's state directory, and `--config` for a configured scenario: the shipped module list, or the fixture modules |
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
its bus published, each with the runtime's generation. It answers only local JSON requests that name its listener, as
the runtime's health does. Ending a stream takes only a part's source, `bunny/parts/<role>`.

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
| `control-scenario-fails` | A negative control, not a catalog scenario: it expects lamp-1 on though nothing switched it, so it must fail |

The run adapter implements the catalog's `Harness` in real time. Its parts are remote, so the per-transport
expectations are the remote ones, and every catalog scenario passes as it does in the in-memory harness. Its
`disconnect` has the runtime's edge end the part's stream, and the same remote part reconnects and hears of the gap,
as in the in-memory harness. The part's timers wait until the next `wait`, so it stays away for the steps in between. A
step's page shows the runtime's health document. The step loads it at its start and again at its end, so `after.png`
shows health as the step left it. There is no dashboard before #922.

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
handling and harness API. It also tests the guard's reach in every thread and child process, and that `build-current`
watches every source the run loads.
Its lifecycle tests drive real transient units through the wrapper and skip with a printed reason where there is no
user manager (#873). See [Runtime verification runs](../../../docs/development.md#runtime-verification-runs).
