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
| Runtime | actual | The runtime through its own entry (`runMain`) with `--simulate`, `--edge` and the run's state directory: the shipped module list, or the fixture modules |
| SDK edge | actual | The runtime's edge on its listener; each part has a run-generated grant in the state directory's `edge-grants.json` |
| Fixture modules | simulated | The stand-in core (session owner, history and inbox until #831, #782 and #923), the fixture lamp and chime, and a harness module that reports what the bus publishes |
| Devices | simulated | `SimulatedLamps` and `SimulatedChime`, held by the supervisor and reached over the runtime child's IPC channel, so they outlive a runtime crash as real devices would |
| Parts | simulated | The scenario's hook, operator, panel and reader: remote parts that the capture step connects to the edge |

The supervisor restarts a runtime that dies on its own, such as an armed crash between the lamp's commit and its
publish, on the same port and state directory, as the service manager would. Its loopback harness API, the run's
`harness` endpoint, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the
chime, arm a crash, lose an acknowledgment, restart) and reports the run's state: the devices, the runtime's log records
and everything its bus published, each with the runtime's generation. It answers only local JSON requests that name its
listener, as the runtime's health does.

## Run scenarios

| Scenario | Starts |
| --- | --- |
| `fixtures` | The stand-in core, the lamp and the chime, for exploring (the default) |
| `shipped` | The runtime's own entry point with the shipped module list, empty today |
| one per catalog scenario, such as `end-to-end` | The modules that catalog scenario's seed names |
| `control-real-transports`, `control-installed-port`, `control-default-state` | Boundary negative controls; see below |

## Capture steps

| Step | What it does |
| --- | --- |
| `edge-grants` | A remote part with the run's reader grant syncs the stand-in core's sessions; one with a made-up token is `unauthenticated` |
| `scenario-<catalog id>` | Runs that catalog scenario through the run adapter on a freshly seeded run, attaches `scenario-result.json`, and expects every step to pass, every message to follow profile 2.0 and the boundaries to hold |
| `control-scenario-fails` | A negative control, not a catalog scenario: it expects lamp-1 on though nothing switched it, so it must fail |

The run adapter implements the catalog's `Harness` in real time. Its parts are remote, so the per-transport
expectations are the remote ones, and every catalog scenario passes as it does in the in-memory harness. A step's page
shows the runtime's health document; there is no dashboard before #922.

## Boundaries

A run never reaches an installed service, a port of one, personal state or a device. Three checks prove it at `start`
and in `doctor`:

| Check | Passes when | Negative control | What crosses |
| --- | --- | --- | --- |
| `simulated-transports` | The runtime's `runtime.started` record says it built its modules with `--simulate` | `control-real-transports` | The shipped runtime runs without `--simulate` |
| `no-outbound-connections` | A guard loaded before the runtime refused no outbound TCP connection; the runtime only listens | `control-installed-port` | A probe module reaches for the installed Hub's port 8788; the guard refuses it before it connects |
| `private-state` | The runtime's state directory is the run's own, its home is private to the run, and the grants file is owner-only | `control-default-state` | The runtime runs without `--state-dir`, so it falls back to its default directory, which in a run lies under the run's private home |

The controls fail their start with `check-failed` by design, and are start-only: `scenario <run-id> <control>` and
`handoff <run-id> --reset <control>` are refused with `start-only-scenario` (exit 2) before anything changes. The
core already refuses a ready line on an installed service's port, and the supervisor gives the runtime a home inside
the run, so even a control never touches the owner's files.

## Entry points

Run at most one Acceptance run at a time on this host, because memory is the constraint
([docs/sdlc.md](../../../docs/sdlc.md#acceptance-review)). Run with Node 24 from the repository root, and build first:
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

A reviewer can also use the run by hand: its runtime's URL serves health, and its SDK edge takes a remote part with a
grant from `<runtime dir>/data/state/edge-grants.json`, which `start` never prints.

## Checks

`npm run test:runtime:verify:built` judges every capture step through `runCaptureStep` on runs it starts without a user
manager, starts each negative control, and tests the supervisor's stop, crash restart, orphan handling and harness API.
Its lifecycle tests drive real transient units through the wrapper and skip with a printed reason where there is no
user manager (#873). See [Runtime verification runs](../../../docs/development.md#runtime-verification-runs).
