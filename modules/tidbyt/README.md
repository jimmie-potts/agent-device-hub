# Tidbyt module

Private workspace package `@jimmie-potts/tidbyt`: the runtime module that shows
automatic agent status and what plays on the Tidbyt
([Hub #930](https://github.com/jimmie-potts/agent-device-hub/issues/930)). It
replaces the Tidbyt runner inside the old local controller host at the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). It is in
the runtime's shipped list (`apps/runtime/src/modules.ts`), after the playback
module. The accepted [cutover record](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585)
owns installation and representative physical evidence. The originals in
[`controllers/tidbyt`](../../controllers/tidbyt/README.md) remain in the stopped
old host for manual return until separately authorized
[retirement](https://github.com/jimmie-potts/agent-device-hub/issues/839).

The module writes two background installations through the one backend its section
selects, Tidbyt's cloud by default or a [Tronbyt server](#the-tronbyt-backend), each in
the device's normal rotation:
- the **status tile** follows the module's synced copy of the core's sessions;
- the **now-playing tile** follows its synced copy of the playback module's
  `playback` record ([#929](../playback/README.md#the-playback-record)).

It is the one writer for the device. Each tile pushes only when what it
shows changes, at most once every 15 seconds, and pushes an unchanged frame
again after 10 minutes. Frames render in a worker thread. The module publishes
the Tidbyt's `device/2.0` record. On the cloud every control is unsupported, as the old
controller declared every controller v1 capability unsupported; a server declares
[its controls](#the-displays-controls).

## Reusable dashboard card

The module declares API 1.3 for its React contribution and exports `TidbytCard`
and `TidbytDisplay` from `@jimmie-potts/tidbyt/frontend`. The card is pure
presentation; the adapter follows this module's device copy through the shell's
existing authenticated participant. Home, the device page and
`#/module/tidbyt/display` use that same adapter. The device page keeps its
existing detailed evidence in a collapsed Device evidence section.

Status shows cloud availability and the last known cloud acceptance time.
Disconnected or failed copies keep saved evidence marked stale until a complete
replacement sync succeeds. Retry records repeats only the read. Content explains
automatic agent status and optional now playing; it does not list configured
installations. No power, brightness, content-selection or push/removal controls
are offered on either backend. With a Tronbyt server selected, the labels name the server
instead of the cloud. The wooden 64×32 illustration stays mounted across keyboard-accessible
Status/Content tabs and is explicitly illustrative, never an exact preview or a
physical observation. Existing cloud behavior and private state are unchanged.

After the root build, run
`node --test modules/tidbyt/dist/tests/frontend.test.js` for copy replacement,
failed sync, removal, late-copy cleanup and evidence labels, and
`node apps/runtime/dashboard/tests/tidbyt-card.browser.ts` for all three actual
shell surfaces, held reconnect, read-only access, keyboard/reduced motion,
phone layout and accessibility. The unit cases run in `test:tidbyt-module:built`;
the browser journey runs in the existing hosted dashboard smoke and full local
browser suite. All use synthetic state and a simulated cloud.

## Provenance

Copied from `controllers/tidbyt` at main `627e3fe3` (2026-10-07) and converted to
the [strict profile](../../docs/development.md#strict-profile-for-new-code):

| Source | Here | Change |
| --- | --- | --- |
| `src/webp.ts`, `src/font.ts`, `src/draw.ts` | the same files | Strict profile only; the encoder writes the same bytes. |
| `src/render.ts` | `src/render.ts` | `decodeFrameData` and the frame's wire form are not copied: no message carries a frame. |
| `src/status.ts` | `src/status.ts` | Reads a synced copy of `session/2.0` records through the shared helper in `@jimmie-potts/event-contracts/v2/status` (#918). A copy that has not synced, or whose later sync failed, is the unavailable feed. The neutral label keeps the 1.x identity hash, so a session without a label shows the same `C-` or `X-` ID as before. |
| `src/nowplaying.ts` | `src/nowplaying.ts` | Reads the `playback/2.0` or `playback/2.1` record. `parsePlaybackSnapshot` is not copied. Freshness is the record's `availability`, never the age of `observedAtMs`; see [Now playing](#now-playing). |
| `src/connection.ts` | `src/cloud.ts` | The transport is the module's `fetch`; a deadline is the caller's signal; an uncertain result says whether the cloud answered; the 1.x capability block went with the 1.x snapshot. |
| `src/controller.ts` (queue and holds) | `src/writer.ts` (`CloudQueue`) | The controller v1 envelope, tickets, replays and conflicts are gone: only the module's tiles write. Order, one call in flight, the authentication hold and the rate-limit hold stay. The installation listing now goes through the queue too, where the controller read it beside the queue. A listing the cloud answers with an error makes the Tidbyt `degraded`, where the controller made it `unavailable`; only a listing with no answer makes it `unavailable`. |
| `src/publishing.ts` (`InstallationWriter`) | `src/writer.ts` (`TileWriter`) | The gate runs from the end of the tile's last call, its answer or its deadline, so the cloud sees the pushes at least 15 s apart. A tile can hold. What a tile sent survives a restart, and a write is stored as uncertain until its answer. The gate and the refresh run on the wall clock, where the runner used a monotonic one, with a time in the future taken as now. |
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
- `secrets.token` names the file that holds the selected backend's API key, one token
  used whole. The module reads it once, at start.
- `backend` is optional: `cloud` by default, or `tronbyt`. See
  [The Tronbyt backend](#the-tronbyt-backend).

Any other section is refused with `invalid-request` and a fixed detail that
repeats no value; without a section the module is refused with `not-found`. The
cloud's device ID stays in the private configuration file and the key in its
secret file: no message, record, span, error body or health entry carries either.

### Conversion from the runner

`convertTidbytRunner(runner, credentials)` converts the old runner's
`tidbyt-status.json` (parsed) and the text of the credentials file it names into
this section. A caller that separately selects this optional utility writes
the returned `apiKey` into a private secret file and adds that file to the
section as `secrets.token`. Never print `apiKey`. The selected
[fresh setup](../../apps/runtime/SETUP.md) uses manually selected configuration
and does not run the converter.

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

## The Tronbyt backend

Selected by the section, never by a failure ([Hub #23](https://github.com/jimmie-potts/agent-device-hub/issues/23)):

```json
"tidbyt": {
  "id": "tidbyt",
  "backend": "tronbyt",
  "tronbyt": {"url": "http://192.0.2.10:8000", "deviceId": "<the server's device ID>"},
  "statusInstallation": "agentdevicehub",
  "nowPlaying": {"playback": "living-room", "installation": "nowplaying"},
  "secrets": {"token": "<private file holding the server's API key>"}
}
```

- `url` is the server's origin. It takes no credentials, path, query or fragment, and
  plain `http` only to a loopback, private or single-label host or a `.local`, `.internal`,
  `.lan` or `.home.arpa` name, since each request carries the key.
- `deviceId` is 1 to 128 letters, digits, underscores or hyphens.
- `minIntervalMs` and `refreshMs` are optional, 1 s to a day. They default to the cloud's
  15 s and 10 minutes, which stay fixed on the cloud. See the record below for what has
  been qualified.
- A section holds only the selected backend's settings: `cloudDeviceId` with `tronbyt` is
  refused. Keep the previous section privately for rollback.
- **Change `secrets.token` with `backend`.** Nothing ties a key file to a backend, so a stale
  path would send the cloud's key to the server.
- An installation here must not be all digits. The server looks one up by its own numeric ID
  first, so such a name could reach an unrelated app.

Source configuration here deploys nothing: hosting is
[#1406](https://github.com/jimmie-potts/agent-device-hub/issues/1406) and the device
transition is [#24](https://github.com/jimmie-potts/agent-device-hub/issues/24).

### Compatibility record

Checked 2026-11-03. Neither project had released since the pins below.

| Item | Pinned | Evidence |
| --- | --- | --- |
| Server | v2.5.2 (`linux/arm64` image published) | Source read at v2.5.2. `tests/tronbyt-server.test.ts` passed on a disposable v2.5.2 server (`sha256:fb0c08e9…`) with no device connected, then with a device key on the hosted server of [#1406](https://github.com/jimmie-potts/agent-device-hub/issues/1406), the same image, before any device had connected. First exercised on a disposable v2.5.1 server (`sha256:b266da13…`), with synthetic credentials and no network; v2.5.1 to v2.5.2 changes no API handler, the auth middleware or `API.md`. |
| Firmware | v1.7.4, target `tidbyt-gen1` | Flashed on the owner's Gen 1 under [#24](https://github.com/jimmie-potts/agent-device-hub/issues/24), which holds its acceptance. |
| API | `/v0` | The table below, and `tests/tronbyt-server.test.ts`. |

What differs from the cloud, each exercised on the v2.5.1 server unless its row says otherwise. The disposable v2.5.2 run
asserts only part of this: a named push replacing its own installation, server IDs that differ from
the chosen name, presence found by name, the two 404s as outcomes, a pin outliving its
installation, brightness at the ceiling, a 200 with no device connected and a moment's takeover
and release. The rest of the
table, including the rate row, rests on the v2.5.1 run and the unchanged API source, apart from
the rows that say where they were found:

| Server behavior | What the module does |
| --- | --- |
| `background` defaults to false, which interrupts the display | States it on every push |
| A push with no installation joins a queue kept up to a day, so it could show an expired frame later | Always names one, which replaces its own file |
| The list carries the server's own numeric IDs, never the ID a push chose | Reads presence with `GET /installations/<name>` |
| A missing installation answers 404 `App not found`; a missing device `Device not found` | Removal counts as done for the first, and the Tidbyt turns `unavailable` for the second |
| Brightness is stored unchecked: 101 and -1 were accepted and served | Scales 0 to 100 percent to `BRIGHTNESS_CEILING`, 50, the top of the server's own Gen 1 scale |
| Deleting a pinned installation leaves `pinnedApp` set until `/next` next runs, and a re-pushed one gets a new ID | Clears the pin with the tile and sets it again on return |
| With a device connected over WebSocket and nothing to show, a background push that creates an installation does not refresh the list the server serves it from, so the panel stays on the setup screen. Showing a tile refreshes the list, so this needs an empty list. Read from v2.5.2's source and seen on a panel ([#1411](https://github.com/jimmie-potts/agent-device-hub/issues/1411)) | Follows each background push with an empty `PATCH` of that installation, which refreshes the list and changes no data, though the server's web page redraws the device's card each time. It is part of the write: if it does not succeed, the frame reached the server, so the write is `uncertain` and the writer retries at its backoff. A refusal here sets no hold, which the next push's own refusal does |
| A push returns 200 with no device connected, and without checking the image | A 200 is a transmission, never evidence of the panel |
| `pinned: false` on an installation clears the pin only if that installation holds it, and the device's record names `pinnedApp` | A moment reads the pin first and releases with that write, so it never clears another pin. Read at v2.5.2 and asserted on a disposable v2.5.2 server (Hub #337) |
| No rate limit; writes 1 s apart were all answered | Takes a gate down to 1 s. This qualifies the server, not what the device renders; #24 selects the value |

Run the optional check against a disposable server after a build: its device's
installations, pin and brightness change. It takes a user key, or a device key with
`TRONBYT_QUALIFY_KEY_KIND=device`. A device key is scoped to its device, so use one for the
module; only the check's refusal for another device differs, 403 where a user key hears 404.
The server's device listing returns the owner's devices for either key.

```bash
TRONBYT_QUALIFY_URL=<origin> TRONBYT_QUALIFY_DEVICE=<id> TRONBYT_QUALIFY_KEY=<key> node --test modules/tidbyt/dist/tests/tronbyt-server.test.js
```

### The display's controls

The record declares `brightness` from 0 to 100, and these native modes in
`capabilities.modes`. Without a now-playing tile, its two modes are left out.

| Mode | Effect |
| --- | --- |
| `rotation` | The default. Each tile takes its turn, and a push waits for it, as on the cloud. |
| `interrupt` | A tile's push interrupts the display at once. |
| `pin-status`, `pin-now-playing` | The server shows only that tile while it stands, and the rotation when it does not. The pin follows the tile. |
| `hide-status`, `hide-now-playing` | The module removes that tile and writes it no frame until another mode. |

`brightness-set` and `device-mode-set` are tracked: stored before they are accepted, one
write in the queue's turn, never sent again. `desired` carries what was asked and
`observed` stays `unknown`, because the server knows what it served, never what the panel
shows, so a success is `transmitted` at most. A lost answer or a 5xx is `uncertain`. At most
8 commands wait. Mode and brightness survive a restart; a command a stop or a crash left
without an outcome is reported at the next start, `uncertain` if its write may have begun,
and never runs again. A pin write that failed or went unanswered is a fresh write for the
current mode at the tile's next evaluation at least 60 s later, or at the next start's first
evaluation. `transmitted` covers the
mode's one write: a `hide-<tile>` tile's removal follows at its gate and can fail on its own.

### Moments

The server's record also declares `moments`: the moods `celebrate`, `setback` and `reminder`,
at most 60 s, able to cover status. The cloud refuses `moment-play` and declares none. A moment
is a bounded takeover. It changes no mode and no configuration revision:

1. It is refused with nothing stored or sent when its mood or duration is not declared
   (`unsupported-capability`), its start window has passed (`expired`), a command or another
   moment is in hand (`capacity`), the last moment has not been released (`unavailable`), its
   moment ID was accepted before, or it is blocked (`invalid-state`).
2. Its frame is made once. A failure, or 30 s without one, ends it `failed` with nothing sent.
3. At its start, one queue turn reads the server's pin, pushes the frame in the foreground to
   the installation `bunnymoment`, which no tile may take, and pins it. If a pin stands,
   nothing is written and it ends `failed` with `invalid-state`.
4. It holds for its duration. A request under 30 s holds for 30 s, because the firmware shows a
   frame for its own dwell. Tiles keep writing in the background, and none interrupts.
5. A later turn unpins it and deletes the installation, and the display returns to whatever the
   rotation is then.

| What happens | Effect |
| --- | --- |
| A session has attention, or the sessions' copy does not follow the core | Blocks a moment, and ends one at once |
| A status tile stands and the moment may not cover status | Blocks it, and ends it. A `hide-status` tile does not count |
| The mode pins a tile | Refuses it. Attention and pins outrank moments |
| A pin set on the server's own page | The takeover yields with nothing written. One set during the hold survives the release, because the server applies the unpin only if the moment holds the pin |
| Any other accepted command | Ends it |

The outcome follows the release. `succeeded` and `transmitted` mean the server took the frame
and the pin and answered the release. A moment that ended early after its frame went out is
`failed` with `cancelled` and `transmitted`. One ended before anything went out is `failed` with
evidence `none`: `cancelled` for a later command, `invalid-state` for what it yielded to. A push or pin with no definite answer, or a release that
did not succeed, is `uncertain`. No write goes out twice, and nothing says what the panel showed.

No frame is stored and nothing replays. A stored mark covers a takeover from before its first
request until a release is answered. While it stands, new moments are refused and a fresh
release goes out at a tile's next evaluation, at least 60 s after a failed one. The first failure
logs `operation.failed` with `bunny.operation` `moment`, and the release that works logs
`operation.completed`.

A release waits behind the queue's holds like any write, so **the frame can outlast its time**:

- A rate limit holds the release for its `Retry-After`, at most 15 minutes, even after attention.
- A refused key holds it until the next start reads the key anew.
- A stop or a crash cannot reach the server, so the frame stays pinned until the next start on this
  backend, whose first evaluation releases it. That start reports the moment `uncertain`, and its
  ID stays spent. A start on the cloud, or a rollback to code from before moments, sends no
  release, and a handoff to another server releases nothing on the old one, so clear that pin on
  the server's own page.

The server has no conditional pin. A pin set by hand in the moment between the read and the
moment's pin is overwritten, and the release then clears it.

What a moment shows comes from `TidbytModuleOptions.momentPicture`
(`(moment: MomentPlayRequest, signal: AbortSignal) => Promise<Uint8Array>`, an encoded WebP), a
mood card from `moment-card.ts` by default. `signal` aborts once the answer can no longer be used,
and nothing waits for it after that. Exact art replaces that function and nothing else.

### Changing backend

The runtime stops the module, which ends any call in flight, before starting it with
another section. At that start the module:

1. reports commands left without an outcome, as above;
2. logs `operation.failed` with `bunny.operation` `setup` and `bunny.code` `uncertain-result`
   once if a tile's last write left its presence unknown;
3. drops what the tiles remember and the display's stored state, and logs
   `operation.completed` with `bunny.operation` `setup`;
4. on a server, clears any pin it holds, since the module owns the pin and the mode starts at
   `rotation`, which also clears a pin set by hand before the selection;
5. writes the current frame fresh once its gate allows. No frame is stored, so none can
   replay.

If the database refuses any of this, that run logs a `setup` failure and writes nothing, and
the next start hands off again. The old backend hears nothing more, and
keeps whatever it last showed. Going back works the
same way: restore the previous section and restart. A database from before this record
counts as the cloud's, so upgrading on the cloud pushes nothing while a tile stands. Older
code ignores the new tables and trusts the tiles' last rows: a stale tile is cosmetic and
corrects at the next push or removal. A first start on a completely full disk cannot create
the new tables, so the module waits for space and a restart.

## The device record

The module serves its one `device` record through sync and publishes it on
`bunny.state.device.<id>` (`org.bunny.device.updated`, `device/2.0`, kind
`tidbyt`):

- on the cloud, every capability `{supported: false}`; desired, observed, the last outcome
  and external control `unknown`; `pending` 0, because the cloud answers no command. A
  server's record differs as [its controls](#the-displays-controls) state;
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

`device` is a family several modules serve, so a reader names this module,
`bunny/modules/tidbyt`, as its copy's owner
([#967](https://github.com/jimmie-potts/agent-device-hub/issues/967)).

On the cloud, every general command (#918) on `bunny.cmd.<family>.<id>` is refused with
`unsupported-capability`; a server takes three, as [its controls](#the-displays-controls) and [moments](#moments) state. One whose subject is another device never reaches the
module: the SDK's bus refuses it with `invalid-message` (the profile's routing-ID
rule, Hub #835). Nothing is accepted, so the module has no outcome to report.

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
removed once the copy has not followed for 30 s.

With a ready `playback/2.1` thumbnail, the worker contains the static PNG in a
24×24 black region at `(0, 8)` and draws title and artist to its right, starting
at x=27. The play/pause/stale marker stays above the image. Staleness dims the
image and text together. The worker admits at most 64 KiB and 128×128 input
pixels, checks the declared dimensions and refuses animation or malformed PNGs
before composition. Missing, unsupported or refused artwork uses the existing
text layout. The module never fetches an image or imports the playback owner.

Each render and queued cloud call retains a private observation association.
The module checks it after waits and at queue admission, including after a
rate hold. Superseded work that sent no request leaves the write gate and stored
presence unchanged; a call already sent retains its real outcome. Only a digest
of ready image content joins the stored frame key; bytes and association tokens
are neither persisted there nor added to diagnostics.

### The start window

Each start and restart writes nothing until what a tile shows is known, for at
most 30 s after the module starts (`START_WINDOW_MS`):
- the status tile waits for its copy's first sync. A core that is not serving
  yet never makes it read `FEED ?` over the tile it shows; only a copy that has
  not synced 30 s after the start reads `FEED ?`;
- the now-playing tile waits for its copy's first sync, and then for the
  playback module's first reads. That module keeps its record `unavailable`,
  with unknown playback, from each start until every speaker's first read has
  settled, so a playing card is neither removed nor pushed again across a
  restart, even when the speaker that plays answers after the other. A speaker
  whose first read fails, as when a call gets no answer within 1.5 s, counts as
  not playing: if the other reports another input, the card is removed, and
  pushed again once the speaker answers and the gate opens. A record still
  `unavailable` 30 s after the start removes the card. The module follows the
  record it is given; the window never holds a card the record says has stopped.

## Writes

- **One writer.** Every call to the cloud goes through one queue, one at a time,
  in order, behind a lease on the cloud device in the module's private folder. A
  second runtime on the same state directory never reaches it: its core fails
  first, and the module's own database, which the first runtime keeps to
  itself, refuses it with `SQLITE_BUSY` (Hub #972). A module that cannot take
  the lease, because another holder has it or its folder is not private, writes
  nothing and shows the Tidbyt `unavailable`. The old runner's lease root is
  separate, so the cutover stops the old host first.
- **The gate.** Each tile pushes only when its frame changes, at most once every
  15 s. The 15 s run from the end of the tile's last call: its answer, a failure
  such as a refused connection, or its 10 s deadline when nothing came back. A
  request reaches the cloud before its call ends, however long it takes on the
  way, so within one start, while the wall clock does not step forward, the
  cloud sees a tile's pushes at least 15 s apart; a render and any wait in the
  queue come before the request and never shorten the gap either. Changes in
  between coalesce into one push of the latest state. An unchanged frame is
  pushed again 10 minutes after its push ended. The start's installation listing
  counts against the gate, as the runner's did.
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
  tile stands, and the gate holds across it. Before a push or a removal goes
  out, the tile stores it as uncertain, so a stop or a crash before its answer
  leaves the installation's presence unknown, and the next start reads the list
  before it trusts it. Such a write keeps the time its request went out, because
  nothing is stored once the module stops, and the next start's gate runs from
  that time. Its frame is unknown, so that start pushes the current frame again
  once the gate allows, and the push can reach the cloud less than 15 s after
  the stopped one, by the stopped request's travel time. Start and restart write
  nothing until the shown state is known; see
  [The start window](#the-start-window).
- **The clock.** The gate and the refresh run on the runtime's wall clock, so
  they hold across a restart. A time in the future, after the clock was set
  back, counts as now, so a clock set back delays a tile's next write by at most
  its own wait, never by the step.
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
| `operation.failed` | WARN | The cloud refused a tile's call, answered with a server error, or a render failed, once per run of failures of that tile, and again when the cloud refuses the key or the device inside that run, with the code: `unauthenticated`, `forbidden`, `not-found`, `invalid-request`, `capacity`, `uncertain-result` or `unavailable` |
| `operation.failed` / `operation.completed` | ERROR / INFO | A fault of the module's own in a tile's evaluation, with `bunny.code` `internal` and its `error.type`, once per run of faults; and the next evaluation that completes, with no `bunny.operation.id` |
| `operation.failed` / `operation.completed` | WARN / INFO | A copy stopped following its owner, or follows again: `bunny.operation` `feed`, `bunny.participant` the owner |
| `operation.failed` / `operation.completed` | Registered refusal level (INFO for validation/domain, WARN for `too-large`) / INFO | Artwork refused with a fixed registry code, once per code change, and the next valid ready image: `bunny.operation` `playback`, without `bunny.operation.id`, bytes or association tokens |
| `operation.failed` / `operation.completed` | WARN, or ERROR for `internal` / INFO | The database refused a commit, once per run, with `bunny.operation` `storage` |
| `operation.failed` | WARN | The writer lease was refused at start: `bunny.operation` `startup`, `bunny.reason` `busy`, `unauthorized` or `unavailable` |
| `outbox.republished` | INFO | Each start |

The SDK's `fullDisk(error)` classifier recognizes a wrapped filesystem
`ENOSPC` as a storage capacity failure, just like SQLite `SQLITE_FULL`.

Each cloud call that goes out has a `bunny.device.call` span, the child of the
message that asked for the tile's evaluation; a call a hold kept back has none.
No trace context reaches the cloud.

Sync serves the device record as last committed. While the database refuses
commits, a reader gets that record, and the module commits and publishes the new
one once the database works again.

## Simulated cloud

`SimulatedCloud` answers the module's three calls as the cloud does, with its
status codes, so the module's own classification runs in tests and disposable
runs. It takes only its key (the synthetic token by default) and its device
(`simulated-tidbyt`), keeps its installations across runtime restarts, and shows
each installation's last frame as 32 text rows of 64 characters: `.` dark, `A`
amber, `B` blue, `G` green, `R` red, `W` white or grey, lower case when dimmed.
A test or run can take it offline, refuse connections, answer the next calls
with a status of its choice, or carry out the next call and lose its answer. The runtime's `--simulate` builds the module with
it; the catalog's `tidbyt-tiles` scenario drives it
([runtime README](../../apps/runtime/README.md#scenario-catalog)).

## Tests

`npm run test:tidbyt-module` builds, then runs `test:tidbyt-module:built`. The
tests need no cloud and no Python.

`artwork-render.test.ts` compares complete independently expected RGB frames
with WebP decoded through libwebp, including paused/stale cards, narrow artwork,
long text and exact text fallback. `writer.test.ts` covers obsolete renders,
queued pushes/removals and rate holds. The runtime's `speaker-artwork` scenario
uses both real display workers and fake queues, counts one producer acquisition
and clears the Sony image on a same-title Sonos handoff. See
[the focused commands](../../docs/development.md#tidbyt-module-checks).

### Physical artwork trial

This trial belongs to [#1054](https://github.com/jimmie-potts/agent-device-hub/issues/1054)
after its established runtime upgrade. Golden frames and cloud acknowledgment
do not establish visible-device acceptance.

1. Verify the installed revision, running identity and health through the
   qualified runtime upgrade procedure. Privately confirm the configured cloud
   device and installation IDs and obtain authorization for content replacement.
2. Play an owner-selected Sony track with artwork. Wait for the tile's 15 s gate
   and its next normal rotation opportunity; observe image, text and status.
3. Select another track and observe its current image at the next eligible
   opportunity. Then select missing-artwork content or hand off to Sonos and
   observe readable text with the Sony image cleared.
4. Stop playback and observe removal of the now-playing installation while the
   normal rotation and status tile continue. If the trial fails, use the
   qualified runtime recovery procedure; do not start the retained old writer
   concurrently. Keep targets, content and observation evidence private, and
   publish only sanitized results with the tested revision and their limits.

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
- `tronbyt.test.ts`: the server's wire form and classification, the section, identical frames
  through both backends, the gate, commands, modes, the pin, a restart, the handoff in both
  directions, and secrecy, on `SimulatedTronbyt`.
- `moments.test.ts`: the takeover, its bounds, what it yields to, a restart, failed writes and the
  picture seam, on `SimulatedTronbyt`.
- `tronbyt-server.test.ts`: the optional check against a real server. It skips unless one is
  named.
- `module.test.ts`: both tiles from synced records, the gate under bursts and
  for a push that reaches the cloud late or never answers, the refresh, removal,
  a lost or slow copy, failed, uncertain and held writes, a cloud that does not
  answer at start, rendering and its end at stop, a restart, the start window, a
  stop during a push, a wall clock set back, the device record, the lease, a
  database that refuses commits, fault records and secrecy, on the simulated
  cloud and a manual clock.
- `kit.test.ts`: the module test kit, with policy A's offline check.

The 1.x tests of the Hub feed, the SSE subscription, the runner's private files
and the local process lease have no counterpart: the module reads its copies on
the bus, and the runtime checks its configuration and secret files (#919).

## What the webcam should show at the cutover

For #840's physical check, with one real agent session and the speakers:

Both tiles are background installations, so the Tidbyt shows each only on its
turn in the rotation, for the time the Tidbyt app gives each app. A change
reaches the cloud within about 15 s, and appears on the display when its tile
next comes round.

- **Status tile:** one row per root session. A working session shows a blue
  square, its label in light grey and `RUN` in blue at the right. A question or
  approval turns the square and the word amber, `ASK`. A finished turn shows
  green `DONE` until a consumer acknowledges it. An idle agent setup leaves the
  rotation.
- **Now-playing tile:** while music plays, a green triangle at the top left, the
  title in light grey and the artist in blue. Pause turns the marker into two
  amber bars. Stopping the music removes the tile.
- **Speakers that stop answering:** the card dims and shows `?` while the
  playback record is `stale`, 5 to 30 s after the speaker's last answer. Once the
  record turns `unavailable` at 30 s, the card leaves the rotation; it does not
  stay dimmed.
- **A lost copy of the sessions:** the status rows dim with `?`, or the tile
  reads `FEED ?`; the tile stays in the rotation.
- **A restart of the runtime:** the now-playing tile stays as it was, neither
  removed nor pushed again while the same song plays. The core marks every
  stored session `uncertain` at a restart, so the status tile's rows are pushed
  again dimmed with `?` as soon as its 15 s gate allows, and each row turns
  bright again once its session reports again.

Source tests, a running module and cloud receipts do not establish what the
display shows; the owner's visual check does.
