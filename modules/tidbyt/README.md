# Tidbyt module

Private workspace package `@jimmie-potts/tidbyt`: the runtime module that shows
automatic agent status and what plays on the Tidbyt
([Hub #930](https://github.com/jimmie-potts/agent-device-hub/issues/930)). It
replaces the Tidbyt runner inside the old local controller host at the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). It is in
the runtime's shipped list (`apps/runtime/src/modules.ts`), after the playback
module. Nothing installs it until the cutover. The originals in
[`controllers/tidbyt`](../../controllers/tidbyt/README.md) keep running in the
installed host until the retirement
([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).

The module writes two background installations through Tidbyt's cloud, each in
the device's normal rotation:
- the **status tile** follows the module's synced copy of the core's sessions;
- the **now-playing tile** follows its synced copy of the playback module's
  `playback` record ([#929](../playback/README.md#the-playback-record)).

It is the one writer for the cloud device. Each tile pushes only when what it
shows changes, at most once every 15 seconds, and pushes an unchanged frame
again after 10 minutes. Frames render in a worker thread. The module publishes
the Tidbyt's `device/2.0` record with every control unsupported, as the old
controller declared every controller v1 capability unsupported.

## Provenance

Copied from `controllers/tidbyt` at main `627e3fe3` (2026-10-07) and converted to
the [strict profile](../../docs/development.md#strict-profile-for-new-code):

| Source | Here | Change |
| --- | --- | --- |
| `src/webp.ts`, `src/font.ts`, `src/draw.ts` | the same files | Strict profile only; the encoder writes the same bytes. |
| `src/render.ts` | `src/render.ts` | `decodeFrameData` and the frame's wire form are not copied: no message carries a frame. |
| `src/status.ts` | `src/status.ts` | Reads a synced copy of `session/2.0` records through the shared helper in `@jimmie-potts/event-contracts/v2/status` (#918). A copy that has not synced, or whose later sync failed, is the unavailable feed. The neutral label keeps the 1.x identity hash, so a session without a label shows the same `C-` or `X-` ID as before. |
| `src/nowplaying.ts` | `src/nowplaying.ts` | Reads the `playback/2.0` record. `parsePlaybackSnapshot` is not copied. Freshness is the record's `availability`, never the age of `observedAtMs`; see [Now playing](#now-playing). |
| `src/connection.ts` | `src/cloud.ts` | The transport is the module's `fetch`; a deadline is the caller's signal; an uncertain result says whether the cloud answered; the 1.x capability block went with the 1.x snapshot. |
| `src/controller.ts` (queue and holds) | `src/writer.ts` (`CloudQueue`) | The controller v1 envelope, tickets, replays and conflicts are gone: only the module's tiles write. Order, one call in flight, the authentication hold and the rate-limit hold stay. |
| `src/publishing.ts` (`InstallationWriter`) | `src/writer.ts` (`TileWriter`) | The gate runs from the moment a request goes out. A tile can hold. What a tile sent survives a restart. |
| `src/publisher.ts`, `src/nowplaying-publisher.ts` | `src/module.ts` | The tiles follow synced copies instead of reading the Hub. |
| `src/runner.ts` (`acquireWriterLease`) | `src/lease.ts` | By way of the LIFX module's copy (#928); the lease file lives in the module's private folder. |
| `src/credentials.ts` | `src/configuration.ts` (`parseRunnerCredentials`) | Used only by the conversion. |
| `tests/test_golden.py` (Pillow) | `tests/golden.test.ts` | `sharp`'s libwebp decodes each golden in Node. |

The golden frames under `fixtures/` are byte-for-byte copies. `tests/frames.ts`
draws the status and now-playing goldens from 2.0 records that hold what the 1.x
fixtures held, and the same bytes come out.

## Configuration

The module's section of the runtime's
[configuration file](../../apps/runtime/README.md#configuration)
([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919)):

```json
"tidbyt": {
  "id": "tidbyt",
  "cloudDeviceId": "<the device ID from the Tidbyt app>",
  "statusInstallation": "agentdevicehub",
  "nowPlaying": {"playback": "living-room", "installation": "nowplaying"},
  "secrets": {"token": "/home/owner/.config/agent-device-hub/secrets/tidbyt-api-key"}
}
```

- `id` is the device record's routing ID. The module names it as its one device,
  so the runtime refuses another module that names it.
- `cloudDeviceId` is 1 to 128 letters, digits, underscores or hyphens.
- `statusInstallation` is letters and digits only, `agentdevicehub` by default.
- `nowPlaying` is optional. `playback` is the routing ID of the `playback` record
  to show; `installation` is the card's own installation, `nowplaying` by default,
  and differs from the status tile's.
- `secrets.token` names the file that holds the cloud's API key, one token used
  whole. The module reads it once, at start.

Any other section is refused with `invalid-request` and a fixed detail that
repeats no value; without a section the module is refused with `not-found`. The
cloud's device ID stays in the private configuration file and the key in its
secret file: no message, record, span, error body or health entry carries either.

### Conversion from the runner

`convertTidbytRunner(runner, credentials)` converts the old runner's
`tidbyt-status.json` (parsed) and the text of the credentials file it names into
this section. The cutover's installer
([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)) runs it,
writes the returned `apiKey` into a private secret file, and adds that file to
the section as `secrets.token`. Never print `apiKey`.

- It keeps the cloud's device ID and both installation IDs, so the tiles already
  in the rotation are the ones the module writes, and none is left behind.
- The device ID is `tidbyt`, as the local controller host named it.
- The now-playing `sourceId` becomes the playback record's routing ID by the
  playback module's rule (`playbackIdOf`, the same as `routingIdOf`), and
  `renamedFrom` names a renamed one.
- The runner's Hub URL, owner and Hub token files have no part in the module,
  which follows the core and the playback module on the runtime's bus.
- The publishers' runtime state starts fresh (owner decision 10, 2026-10-06).

A runner configuration or credentials file the runner would refuse is refused
with fixed text.

## The device record

The module serves its one `device` record through sync and publishes it on
`bunny.state.device.<id>` (`org.bunny.device.updated`, `device/2.0`, kind
`tidbyt`):

- every capability `{supported: false}`; desired, observed, the last outcome and
  external control `unknown`; `pending` 0, because the Tidbyt answers no command;
- `availability`: `unknown` until the cloud first answers; `available` once it
  accepted a write or listed the installations; `degraded` while it rate limits,
  refuses a request or answers with a server error; `unavailable` while it does
  not answer, refuses the key or the device, or when the module could not take
  the writer lease;
- `lastTransmission`: each push or removal the cloud accepted, with
  `operationIds` `push` or `remove`. It is never an observation: no backend
  reports what the display shows.

A new revision is published only when availability or the last transmission
changes; a poll that changes nothing publishes nothing. The revision rises
across restarts. Each start publishes `unknown`, or `unavailable` without the
lease.

`device` is a family several modules serve. Owner-addressed sync
([#967](https://github.com/jimmie-potts/agent-device-hub/issues/967)) lets a
reader name this module, `bunny/modules/tidbyt`, as the owner. Until it lands, a
runtime that also runs the LIFX module refuses the Tidbyt module's `serveSync`,
and the module fails at start.

Every general command (#918) on `bunny.cmd.<family>.<id>` is refused with
`unsupported-capability`, and one whose subject is another device with
`invalid-request`. Nothing is accepted, so the module has no outcome to report.

## The tiles

The layouts, colors and texts are the runner's; the old controller's
[README](../../controllers/tidbyt/README.md#agent-status-decisions) holds the
owner's decisions.

### Agent status

Up to four 8-pixel rows, one per root session: a colored marker, a label of up to
ten characters and a state word. `ASK` (amber) means the session waits for a
person, `RUN` (blue) that it or a child works, and `DONE` (green) that a finished
turn has no consumer's acknowledgment. Rows are ordered ASK, RUN, DONE, then
newest evidence first. With more than four sessions, the tile draws three rows
and `+N MORE`. A session whose freshness is uncertain is dimmed with a `?`
marker. While the copy of the sessions does not follow the core, every row is
dimmed that way, or the tile reads `FEED ?` when it has no rows; the tile is
never removed then. When nothing needs showing, the tile leaves the rotation.

### Now playing

A green play triangle or amber pause bars, the title on up to two rows and the
artist in blue, for a `playing` or `paused` record that is `available` or
`stale`. A `stale` record dims the card and shows `?`. An `unavailable` record,
unknown playback, a stopped track or another input removes the card. While the
copy does not follow the playback module, the last card is dimmed, and it is
removed once the copy has not followed for 30 s. Until its first sync succeeds, for at
most 30 s after the module starts, the tile writes nothing, so a playback module
that starts a moment later never makes it remove a playing card.

## Writes

- **One writer.** Every call to the cloud goes through one queue, one at a time,
  in order, behind a lease on the cloud device in the module's private folder. A
  second runtime on the same state directory is refused the lease, writes
  nothing and shows the Tidbyt `unavailable`. The old runner's lease root is
  separate, so the cutover stops the old host first.
- **The gate.** Each tile pushes only when its frame changes, at most once every
  15 s. The 15 s run from the moment each request goes out, after its render and
  any wait in the queue. Changes in between coalesce into one push of the latest
  state. An unchanged frame is pushed again after 10 minutes. The start's
  installation listing counts against the gate, as the runner's did.
- **Removal.** A tile with nothing to show is removed. When its presence is
  unknown, the tile reads the installation list first and deletes only an
  installation that is there.
- **Failures.** A write that failed or may have taken effect is never sent again;
  a later write is a fresh one for the current state. The wait after a write not
  confirmed sent starts at 15 s and doubles up to 10 minutes. An uncertain push
  makes the installation's presence unknown.
- **Holds.** A 401, a 403 or the cloud's "no UID" 500 holds every later call
  without a request until the runtime restarts and reads the key again. A 429
  holds later calls for its `Retry-After`.
- **Restarts.** What each tile last sent, when, and whether its installation is
  present are kept in the module's database. A restart pushes nothing while the
  tile stands, and the gate holds across it. Start and restart write nothing
  until the shown state is known: the status tile waits for its first sync to
  settle, and the now-playing tile as above.
- **Stop.** A stop ends the call in flight, whose result is then unknown, sends
  nothing more, and ends a render in progress. Both tiles stay in the rotation.

Rendering runs in a worker thread through the runtime's `workers.call`, with a
5-second deadline. A failed render sends nothing, is no evidence about the
device, and is tried again after the wait above.

## Failures and policy A

Under policy A ([ADR 0012](../../docs/decisions/0012-bunny-event-platform.md),
"Failure isolation"), start opens only the database, the private folder with the
lease, the API key's file and the bus, and syncs its two copies. It reaches the
cloud afterwards, with a 10-second deadline per call on the runtime's scheduler.
The cloud's errors and timeouts become device state and records, never a module
failure. A database that refuses a commit is logged once per run of refusals,
and the record is published again once a commit works. An API key that is not
printable ASCII fails the start.

## Diagnostics

The module logs through its context under `bunny.module`, with `bunny.device.id`
the Tidbyt's routing ID. It never logs the cloud's device ID, the key or a frame:

| Record | Level | When |
| --- | --- | --- |
| `device.unavailable` | WARN, then a DEBUG summary at most once a minute | The cloud does not answer, once per outage (`DeviceAvailability`) |
| `device.available` | INFO | The cloud answers again, with the failed attempts and the outage's length |
| `operation.completed` | INFO | The cloud accepted a push or a removal: `bunny.operation` `status` or `playback`, `bunny.operation.id` `push` or `remove` |
| `operation.failed` | WARN | The cloud refused a tile's call, answered with a server error, or a render failed, once per run of failures of that tile, with the code: `unauthenticated`, `forbidden`, `not-found`, `invalid-request`, `capacity`, `uncertain-result` or `unavailable` |
| `operation.failed` / `operation.completed` | WARN / INFO | A copy stopped following its owner, or follows again: `bunny.operation` `feed`, `bunny.participant` the owner |
| `operation.failed` / `operation.completed` | WARN, or ERROR for `internal` / INFO | The database refused a commit, once per run, with `bunny.operation` `storage` |
| `operation.failed` | WARN | The writer lease was refused at start: `bunny.operation` `startup`, `bunny.reason` `busy`, `unauthorized` or `unavailable` |
| `outbox.republished` | INFO | Each start |

Each cloud call has a `bunny.device.call` span, the child of the message that
asked for the tile's evaluation. No trace context reaches the cloud.

## Simulated cloud

`SimulatedCloud` answers the module's three calls as the cloud does, with its
status codes, so the module's own classification runs in tests and disposable
runs. It takes only its key (the synthetic token by default) and its device
(`simulated-tidbyt`), keeps its installations across runtime restarts, and shows
each installation's last frame as 32 text rows of 64 characters: `.` dark, `A`
amber, `B` blue, `G` green, `R` red, `W` white or grey, lower case when dimmed.
A test or run can take it offline, refuse connections, or answer the next calls
with a status of its choice. The runtime's `--simulate` builds the module with
it; the catalog's `tidbyt-tiles` scenario drives it
([runtime README](../../apps/runtime/README.md#scenario-catalog)).

## Tests

`npm run test:tidbyt-module` builds, then runs `test:tidbyt-module:built`. The
tests need no cloud and no Python.

- `render.test.ts`, `golden.test.ts`: the renderer's copied tests, the worker's
  render, and the golden frames decoded by `sharp`, with a changed pixel, a
  truncated image and a changed expectation as negative controls.
- `status.test.ts`, `nowplaying.test.ts`: the copied view and frame tests on 2.0
  records.
- `cloud.test.ts`: the copied connection tests against a fake `fetch`.
- `writer.test.ts`: the queue's order, deadline, close and holds, and the tile
  writer's listing check and restored memory, from the copied controller and
  publisher tests.
- `configuration.test.ts`: the section, the conversion and the copied credentials
  cases.
- `simulated.test.ts`: the simulated cloud and its picture.
- `module.test.ts`: both tiles from synced records, the gate under bursts, the
  refresh, removal, a lost or slow copy, failed, uncertain and held writes, a
  cloud that does not answer at start, rendering and its end at stop, a restart,
  the device record, the lease, a database that refuses commits and secrecy, on
  the simulated cloud and a manual clock.
- `kit.test.ts`: the module test kit, with policy A's offline check.

The 1.x tests of the Hub feed, the SSE subscription, the runner's private files
and the local process lease have no counterpart: the module reads its copies on
the bus, and the runtime checks its configuration and secret files (#919).

## What the webcam should show at the cutover

For #840's physical check, with one real agent session and the speakers:

- **Status tile**, in the rotation beside the other apps: one row per root
  session. A working session shows a blue square, its label in light grey and
  `RUN` in blue at the right. A question or approval turns the square and the
  word amber, `ASK`. A finished turn shows green `DONE` until a consumer
  acknowledges it. Each change appears within about 15 s. An idle agent setup
  leaves the rotation.
- **Now-playing tile**: while music plays, a green triangle at the top left, the
  title in light grey and the artist in blue. Pause turns the marker into two
  amber bars within about 15 s. Stopping the music removes the tile.
- With the speakers or the runtime's sessions unreachable, the tiles dim and show
  `?`, or the status tile reads `FEED ?`, rather than going blank.

Source tests, a running module and cloud receipts do not establish what the
display shows; the owner's visual check does.
