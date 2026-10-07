# LIFX module

`@jimmie-potts/lifx` is the runtime's LIFX module
([Hub #928](https://github.com/jimmie-potts/agent-device-hub/issues/928)), written
against the [module API](../../packages/sdk/README.md#modules) 1.1 under
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md). It replaces the LIFX
half of the old [local controller host](../../apps/local-controllers/README.md) at
the cutover ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)).
Until then the installed service keeps running
[`controllers/lifx`](../../controllers/lifx/README.md), which stays unchanged until
the retirement story ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).
Nothing installs this module yet, and its tests and disposable runs use simulated
bulbs only.

The runtime ships it after the core (`apps/runtime/src/modules.ts`), through
`lifxModuleFactory`: `udpNetwork` for real bulbs, or `SimulatedLifx` under
`--simulate`. A runtime without a `lifx` section in its
[configuration file](../../apps/runtime/README.md#configuration) refuses the module
with `not-found` and runs on. The factory's `simulatedSection`,
`LIFX_SIMULATED_SECTION`, configures the simulated build with `pendant-1` and the
Beam at documentation addresses; the maintenance intake test and the `shipped`
disposable run use it.

## Provenance

Copied on 2026-10-07 from `controllers/lifx` at main `483d3a93`, with its tests, and
converted to the strict profile and the module boundary. The module imports only
`@jimmie-potts/sdk` and `@jimmie-potts/event-contracts`, never `device-contracts`,
`agent-state` or `agent-status`.

| Source | Module file | What changed |
| --- | --- | --- |
| `src/protocol.ts` | `src/protocol.ts` | Checked indexed reads and no non-null assertions; packets, correlation and address rules unchanged. |
| `src/controller.ts`, class `Bulb` | `src/queue.ts` | The controller v1 envelope, admission and receipts are gone; each attempt's deadline runs on the module's scheduler; `cancel` and `closeGracefully` became `close`, which aborts the call in flight. |
| `src/controller.ts`, mode files | `src/store.ts`, `src/conversion.ts` | Modes live in the module's SQLite file; the old files are read once, by the cutover's conversion. |
| `src/status-publisher.ts` | `src/status.ts`, `src/module.ts` | The status comes from the module's synced copy of the core's sessions, through `highestStatus` in `@jimmie-potts/event-contracts/v2/status`. |
| `acquireWriterLease` in `controllers/tidbyt/src/runner.ts` | `src/lease.ts` | Lease files live in the module's private folder; a held lease is an answer, not a throw. |
| `tests/protocol.test.mjs` | `tests/protocol.test.ts` | The same cases; the last drives the queue. |
| `tests/controller.test.mjs` | `tests/queue.test.ts`, `tests/module.test.ts` | Queue cases kept with a manual scheduler. Envelope cases (request order, epochs, receipt eviction, profile versions, joins and replays) became the module's 2.0 refusals and duplicates. |
| `tests/status.test.mjs` | `tests/queue.test.ts`, `tests/module.test.ts`, `tests/configuration.test.ts` | Paint and close cases in the queue; mode cases in the module; mode-file safety in the conversion. |
| `tests/status-publisher.test.mjs` | `tests/status.test.ts` | Mapping, caps, transitions, stale input, offline bulb and modes kept. The status feed's own cases (SSE notices, the 30-second poll, authentication) have no counterpart: a sync replaces the feed, and the SDK's tests cover it. The collector state has no 2.0 home ([MAPPING.md](../../packages/event-contracts/MAPPING.md#agent-status)). |

## Configuration

The module's section of the runtime's configuration file:

```json
{
  "bulbs": [
    {"id": "pendant-1", "address": "192.168.1.40", "vendor": 1, "product": 27, "firmwareMajor": 2, "firmwareMinor": 90,
     "status": {"brightnessCapPercent": 50, "quietCapPercent": 20}, "initialMode": "work"},
    {"id": "beam", "address": "192.168.1.41", "vendor": 1, "product": 38, "firmwareMajor": 3, "firmwareMinor": 70}
  ],
  "timeoutMs": 500, "retries": 1, "maxPending": 8
}
```

- `bulbs`: 1 to 32, each with a routing `id` (lowercase letters and digits with
  single hyphens, unique across modules) and a unicast IPv4 `address`. The
  runtime refuses a module that names a device another module named.
- The model evidence decides the controls. Only LIFX A19 vendor 1, product 27 on
  firmware 2.90 is qualified ([#17](https://github.com/jimmie-potts/agent-device-hub/issues/17)).
  Any other bulb, such as the Beam, is listed with no controls and never reached.
  Never infer a model from a bulb's informal name.
- `status`: the bulb shows automatic agent status, with its caps (integers 1 to
  100, defaults 50 and 20). Without it the bulb is never painted, as the old host's
  per-bulb `status` block decided.
- `initialMode`: the mode a qualified bulb starts in when the module's database has
  none yet (default `free`). After that, the database holds the mode.
- `timeoutMs` (10 to 5000), `retries` (0 to 3) and `maxPending` (1 to 32) bound
  each bulb's queue, as before.

The module reads no secret; a `secrets` member is ignored. No refusal repeats a
value from the section, and no message, record or health entry carries an
address.

### Conversion at the cutover

`convertLegacyConfiguration(block, modes)` turns the old host's `lifx` block into
this section, and `readLegacyModes(folder, deviceIds)` reads each bulb's mode from
the old host's `modes/` folder under its lease root, with the old controller's
fail-closed rules: a linked file, a folder or file others can read, a missing file
or invalid JSON reads as Free, which is the mode the old controller started that
bulb in. The installer ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935))
runs both. The conversion:

- keeps every bulb's address and model evidence, and a qualified bulb's mode as
  `initialMode` (`Work` becomes `work`);
- keeps a bulb's `status` caps only when the block also configured the status feed,
  since the old host painted only with both;
- carries `timeoutMs`, `retries` and `maxPending` over, and drops the controller
  and source IDs and the feed, which the module does not need;
- renames a device ID that is not a routing ID (`Desk_Lamp` becomes `desk-lamp`)
  and reports each rename;
- checks the result with the module's own `configure`, so it refuses what the
  runtime would refuse.

## Records and commands

Each bulb publishes its `device/2.0` record (#918) on `bunny.state.device.<id>`
and its `lifx-light/2.0` record on `bunny.state.lifx-light.<id>`, and serves both
through sync. `device` is a shared family that every device module serves for its
own devices, so a consumer syncs it from this module by name, with
`{owner: 'bunny/modules/lifx'}` (#967). `lifx-light` holds the color capabilities (color, and 1500 to 9000 K)
and the last LightGet reading in degrees, percent and kelvin.

| Family | Key | Device work | Outcome type |
| --- | --- | --- | --- |
| `power-set` | `bunny.cmd.power-set.<id>` | DeviceSetPower | `org.bunny.power.set.completed` |
| `brightness-set` | `bunny.cmd.brightness-set.<id>` | LightGet, then LightSetColor | `org.bunny.brightness.set.completed` |
| `device-mode-set` | `bunny.cmd.device-mode-set.<id>` | none: the mode commits in the module's database | `org.bunny.device-mode.set.completed` |
| `lifx-color-set` | `bunny.cmd.lifx-color-set.<id>` | LightGet, then LightSetColor with hue and saturation | `org.bunny.lifx-color.set.completed` |
| `lifx-temperature-set` | `bunny.cmd.lifx-temperature-set.<id>` | LightGet, then LightSetColor with kelvin | `org.bunny.lifx-temperature.set.completed` |

A command is checked, then stored, then accepted. These refusals prove no effect:

| Code | When |
| --- | --- |
| `invalid-message`, `invalid-request` | The command fails its family's schema, uses another family than its key, or names another bulb in its subject. |
| `revision-conflict` | `expectedConfigurationRevision` or `expectedGeneration` is stale; the generation's epoch changes at every start. |
| `unsupported-capability` | The bulb does not offer the operation (`commandSupported`), as for every command to an unqualified bulb. |
| `unavailable` | The module does not hold the bulb's writer lease: another holder has it ("another writer holds the bulb"), its folder or file is not private ("the bulb's lease is not private"), or it could not be opened ("the module could not open the bulb's lease"). Or the module is stopping: a command that arrives then is refused by the bus or the module. |
| `capacity` | The bulb's queue is full, or the module's store is full. |
| `internal` | The store refused the command for another reason. |
| `duplicate-conflict` | The source already used this `requestId` for another command. |

A repeat of an accepted command, the same source, `requestId` and body, is
accepted again and changes nothing; the module remembers the last 1024 completed
commands. Each accepted command moves the bulb's `configurationRevision`.

The outcome goes through the module's outbox, stored with the records it changes,
by MAPPING.md's receipt rule:

- an acknowledged write, and a committed mode change, are `succeeded` with
  `transmitted` evidence;
- a write that went out without an acknowledgment is `uncertain` with `none` and
  `uncertain-result`;
- a failure before any write, as a LightGet the bulb does not answer, is `failed`
  with `none` and `unavailable`;
- a command whose own deadline (`expiresat`) passed before it sent its first packet
  or its write, as one that waited in the bulb's queue, is `failed` with `none` and
  `expired`, and sends nothing; a mode change past its deadline changes nothing;
- a command whose work the store could not mark begun, just before its write, is
  `failed` with `none` and the store's `capacity` or `internal`, and sends nothing;
- a command that the module's stop retired before it reached the bulb is `failed`
  with `cancelled`.

Each packet gets at most `retries` more attempts with the same absolute payload
inside its queue turn. No attempt starts after the command's own deadline, the
first included, and the deadline is checked again just before a read-modify-write's
write; that one reading of the clock also decides the write's first attempt, so a
write the check let through is never reported as possibly applied without having
gone out. After that nothing sends a command again: not the module, a restart or
the outbox. The module marks a command's work begun inside its turn, just before its
write, and never for a command that expired. At a start, a command the records show
accepted without an outcome is reported `uncertain` when its write had begun and
`failed` with `cancelled` when it never had, as one that still waited in the queue.
The start reports these for the bulbs whose lease it holds, for a bulb no longer
configured and for a bulb whose lease it could not take for another reason than
another holder. It skips only the commands of a bulb whose lease another holder has
(`busy`): another instance on the same state directory may still have that work in
hand. The outbox sends a stored outcome again at each start until the core
acknowledges it; until [#782](https://github.com/jimmie-potts/agent-device-hub/issues/782)
defines that acknowledgment, tests and the fixture core pass the kit's stand-in
through the `acknowledgments` option, and the shipped module keeps its outcomes.

## Automatic agent status

The module syncs the core's `session` family and paints each qualified bulb with a
`status` block through its own queue: one absolute, zero-duration LightSetColor,
with no LightGet and no change to power.

- `highestStatus` ranks the sessions with no acknowledging-consumer filter, so any
  consumer's acknowledgment retires `done`, as before.
- Work paints the status; Quiet paints only attention, at the quiet cap; Free never
  paints.
- It paints only when the shown key changes, never for an unchanged or newer record
  of the same status, a read or a timer. The key advances to the target whatever
  the paint's result, so a failed paint is not repeated.
- Entering any mode resets the key, so Work or Quiet paints the current status once.
- While the copy has not synced, or after it fails, the status is `unknown`: nothing
  paints, and the bulb keeps its last appearance. The module syncs again after 1 s,
  doubling to 60 s.
- The key is kept in the module's database, so a restart paints nothing while the
  status stands, and paints once when it changed while the module was stopped.
- A change made in the LIFX app stays until the next transition or command.

## Reaching bulbs (policy A)

Start opens only local resources: the database, the leases in the private folder
(`leases/`, one SQLite file per address) and the bus. It then reads each qualified
bulb once with a LightGet, which never changes the bulb, to learn whether it
answers. Restarting the module therefore sends one LightGet per qualified bulb and
writes nothing.

- A bulb that does not answer is `unavailable`, never a module failure. The module
  reads it again after 30 s, doubling to 5 minutes, until it answers.
- A read publishes only what changed: the device record when the bulb's
  availability, power or brightness changed, and the color record when its hue,
  saturation, brightness or kelvin changed. A read that finds the bulb as it was
  publishes nothing (ADR 0012, "Repetition"), so each record's `observedAtMs` is the
  time of the reading it was last published with, and a sync serves the records as
  they were last published.
- Each sync of the records starts one LightGet for a qualified bulb whose reading is
  missing or at least 30 s old, an unavailable one included, at most one per bulb
  every 30 s counting the probe's reads, as the old host's on-demand read did
  (#330). A bulb that came back therefore shows `available` within 30 s of a
  reader's sync, rather than at its next probe. The read follows each sync request,
  not a follower that stays subscribed: a page that keeps a copy sees a bulb come
  back at its next sync or the bulb's next probe. Apart from the start's read and
  the probe of an unavailable bulb, nothing reads a bulb while nothing reads its
  records.
- An unqualified bulb is never reached; its availability stays `unknown`.
- A lease the module cannot take makes the bulb `unavailable` and its commands
  `unavailable` until the next start, and the module runs on. The start logs one
  `operation.failed` with the reason: `busy` for another holder, `unauthorized` for
  a lease folder or file that is not private, and `unavailable` for one that could
  not be opened.
- Stopping the module closes each queue: what waits resolves `cancelled` without
  sending anything, and the call in flight is aborted, so its outcome is
  `uncertain`. An aborted call ends when its transport says it ended, and the stop
  waits for it. The outcomes commit before the database closes and go out at the
  next start, and only then are the leases released.

## Diagnostics

The module logs registered `bunny.module` records (ADR 0012, "Observability"):

| Record | Level | When |
| --- | --- | --- |
| `command.executing` | INFO | An accepted command's device work begins: its turn in the bulb's queue came within its deadline. It carries the request, device and routing key. A command that expired waiting has none. |
| `outcome.published`, `outbox.deferred` | INFO or WARN, WARN | The outbox's records of an outcome's first publication and of a deferred publish. |
| `device.unavailable`, `device.available` | WARN, then DEBUG summaries; INFO | `DeviceAvailability`: one degradation and one recovery per outage, not one warning per read. |
| `feed.changed` | INFO | A bulb's shown status key changes. |
| `operation.failed`, `operation.completed` | WARN or ERROR, INFO | Once per run of store failures (`storage`) or of lost session syncs (`feed`), and at their recovery; a lease the start could not take (`startup`, with `busy`, `unauthorized` or `unavailable`). |
| `outbox.republished`, `outbox.acknowledged` | INFO | At start, and for each acknowledged outcome. |

Each call to a bulb is a `bunny.device.call` span: a command's is in the command's
trace, a paint's in the trace of the session record that changed the status, and a
read's starts its own. No trace context reaches a bulb.

## Physical check at the cutover

#840 checks `pendant-1`, the qualified A19, through the webcam after the install,
with the module in Work and the default caps. The expected results, from the shared
status colors:

| Status | Bulb |
| --- | --- |
| No session waits (idle) | Warm white, 2700 K, no saturation, 50% brightness |
| A turn is running (working) | Blue, hue 218°, saturation 84%, 50% |
| An approval or question waits (attention) | Amber, hue 38°, saturation 100%, 50% |
| A finished turn nobody acknowledged (done) | Green, hue 135°, saturation 80%, 50% |

- Each change shows within a few seconds of the hook observation, and an unchanged
  status repaints nothing.
- In Quiet only attention shows, amber at 20%; leaving attention changes nothing.
- In Free the bulb never changes on its own.
- A bulb switched off stays dark after a status change: a paint never turns it on.
- A color set in the LIFX app stays until the next status change.
- A bulb that was off the network while powered during a status change keeps
  its last color when it comes back, until the next status change or mode command: a failed
  paint is not repeated.

The Beam is not qualified: it must never change, and its record shows no controls.

## Checks

From the repository root, with Node 24: `npm run build`, `npm run typecheck`,
`npm run lint:js` and `npm run test:lifx-module`, which runs the compiled tests in
`modules/lifx/dist/tests/`. The core CI job runs `npm run test:lifx-module:built`
after its fresh build. The tests use `SimulatedLifx`, fake sockets and a manual
clock, and open no socket. `lease.test.ts` starts a Node child process that holds a
bulb's lease, to show another process keeps the module off that bulb. `kit.test.ts` runs the
[module test kit](../../packages/sdk/README.md#module-test-kit), policy A's check
included. The runtime's catalog scenario `lifx-bulbs` runs the module in the
in-memory harness and in [disposable runs](../../apps/runtime/verify/README.md).
See [LIFX module checks](../../docs/development.md#lifx-module-checks).

## Deferred

- The Beam's qualification: [#319](https://github.com/jimmie-potts/agent-device-hub/issues/319),
  [#320](https://github.com/jimmie-potts/agent-device-hub/issues/320) and
  [#327](https://github.com/jimmie-potts/agent-device-hub/issues/327), now against
  this module.
- Detecting changes made outside the module:
  [#362](https://github.com/jimmie-potts/agent-device-hub/issues/362).
  `externalControl` stays `unknown`.
- LIFX in the Hub mode: [#415](https://github.com/jimmie-potts/agent-device-hub/issues/415).
- The core's acknowledgment of outcomes: #782.
- Pages, MCP tools and settings for the module: module API 1.2
  ([#835](https://github.com/jimmie-potts/agent-device-hub/issues/835)).
