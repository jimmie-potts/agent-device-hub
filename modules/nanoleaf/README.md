# Nanoleaf module

Private workspace package `@jimmie-potts/nanoleaf`. It holds the TypeScript port of
[codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf)
([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26); [PORTING.md](PORTING.md)
maps it) and the runtime module that runs it,
`nanoleaf` ([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)), one of
the runtime's shipped modules under
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md). The module shows agent
sessions on the Nanoleaf Lines and NL22 Light Panels, takes Work, Quiet and Free and the
wall's controls as commands, and publishes each controller's state. Nothing installs it
yet; the cutover (#840) does. The wall pages are #934, and the [migration](#migration) of the
bridge's state is #933.

## Factory

`createNanoleafModule({transport})` takes how the module reaches its controllers, a
`LightRequest`: `lightRequest`, the Nanoleaf HTTP client, in the shipped runtime, or a
`SimulatedNanoleaf` controller's `request` in tests and with `--simulate`. Addresses and
tokens come from the module's configuration and secrets, never from the factory.

## Configuration

The module's section of the runtime's [configuration file](../../apps/runtime/README.md#configuration):

```json
{
  "devices": [
    {"id": "wall", "kind": "lines", "address": "192.168.1.20", "secret": "wall-token"},
    {"id": "nl22", "kind": "panels", "address": "192.168.1.21", "secret": "nl22-token"}
  ],
  "qualifiedSources": [{"provider": "codex", "client": "desktop", "hostId": "<host>", "sourceId": "<source>"}],
  "codexMetadata": {"path": "/abs/codex/local-projects.json", "titleIndexPath": "/abs/codex/session_index.jsonl"},
  "secrets": {"wall-token": "/abs/secrets/wall-token", "nl22-token": "/abs/secrets/nl22-token"}
}
```

- `devices`: 1 to 8 controllers, each with a routing ID, its kind, a private IPv4 address
  and the name of its token's secret file. Exactly one is the Lines, with the ID `wall`,
  the port's original device.
- `qualifiedSources`: the agent sources whose sessions the wall shows; others are skipped.
- `codexMetadata` (optional): Codex Desktop's project catalog and title index, read only.

Anything else is refused with `invalid-request` and fixed text. At start the module writes
the port's registry, `config.json`, to its private folder with each device's secret name
and no token, reads each token with `secrets.read` and keeps it in memory. Its store is
the runtime's `modules/nanoleaf.sqlite`; its layouts, scene files and worker locks live in
its private folder.

## Migration

The cutover (#840) carries the codex-nanoleaf bridge's state into the module with an offline tool
([#933](https://github.com/jimmie-potts/agent-device-hub/issues/933)), which the installer (#935) runs before the
runtime's first start. The runtime README's
[Nanoleaf migration](../../apps/runtime/README.md#nanoleaf-migration) gives its command line, exit codes and refusals;
`src/migration/` holds what it carries and checks. It reads the bridge's private state directory in either of two
shapes and never changes it:

- the installed release's: codex-nanoleaf `c711e18`, model version 4, with each row's device;
- the pre-change Linux database without device keys (the `linux-state-v4` fixture), whose rows all belong to the
  Lines.

What it carries, through SQLite, into the module's store and folder, for each device the registry names:

| Carried | From | Into |
| --- | --- | --- |
| The project map and colors | `projects` | `projects` |
| The palette | `palette` | `palette` |
| Each element's project and halves | `line_prefs` | `line_prefs` |
| Map settings (layout style, coverage, rotation and flips) | `map_settings` | `map_settings` |
| A pending wall edit | `map_pending` | `map_pending`, which the worker applies once no comet runs, as after a restart |
| Favorites | `animation_favorites` | `animation_favorites` |
| Each device's desired state: Work, Quiet or Free, a native power or brightness override, and how far its worker applied the mode | `meta`: `mode`, `mode_revision`, `mode_applied`, `controller_power`, `controller_brightness` (with `@<device>`) | `meta` |
| The layout | `layout.json` | `layout.json`, version 2, each device's elements, zones, positions and geometry |
| Each device's remembered scene | `scene-state*.json` | the same files |
| Addresses and tokens | `config.json`'s registry | the module's [section](#configuration), with each token as a private secret file |
| The qualified agent sources | the shared-input configuration, without `bindings` | the section's `qualifiedSources` |
| Codex Desktop's metadata paths | `config.json`'s `metadata_path` and `title_index_path` | the section's `codexMetadata` |

These start fresh and stay only in the backup (owner decision 10, 2026-10-06, and the #26 decision). The tool counts
each of them in its report:

- tasks and what follows them: `sessions`, `task_info`, `activity`, `waits`, `receipts` and the shared-input task tables;
- reservations (`slots`), comets, Locate and display caches;
- task and effect epochs, holds and failures in `meta`;
- the controller ledger and the integration API's requests;
- the legacy task backup and the shared-input configuration's `bindings`;
- the rows, layout entries and scene files of a device the registry no longer names.

The destination's `shared_input` row is a fresh one. Its source is `'legacy'`, which the module reads as not selected
until its first sync selects shared input.

The verifier compares each carried row by its key, with its SQLite storage class; each file as parsed JSON; the section
member by member; and each secret through the runtime's own reader. It also counts what should not be there. The
cutover goes ahead only on zero mismatches.

There is no enrollment command yet (owner decision, 2026-10-07): it waits until a device is added, and
`src/enrollment.ts`, the port's enrollment, is ready for it. Until then, a new address is a one-line edit of the
device's `address` in the module's section; the device keeps its ID, and with it its preferences and scenes.

## Families

The module answers each device's own keys, `bunny.cmd.<family>.<device id>`, and serves
`device`, `nanoleaf-wall` and `nanoleaf-animations` through sync, as its health entry's
`serves` lists. Every device module serves `device` for its own devices (#967), so a
consumer syncs it from `bunny/modules/nanoleaf` by name. Its own schemas are
`nanoleafSchemas`; `nanoleafMessageSchemas` adds the general device families.

Favorites are private to the owner, so the device record and the wall view never hold a
favorite or preset name. `nanoleaf-animations` is the one exception, by design: it is the
Lines' animation options, the view a play request is chosen from, so it lists the saved
favorites with their names and recipes and the module's presets, and any principal allowed
to read the module's families reads them there. Favorites stay out of browser projections;
the wall pages (#934) apply that rule.

| Family | Kind | What it does |
| --- | --- | --- |
| `device` | state | Each controller's `device/2.1` record, with `held` while a hold stops its writes |
| `nanoleaf-wall` | state | Each controller's wall map: settings, palette, projects, elements and tasks with their eviction tokens, whether its last pass failed or no worker runs (`failing`), and whether a hold stops its writes (`held`) |
| `nanoleaf-animations` | state | The Lines' animation options: presets, favorites, patterns, bounds, the queued animation, saved positions and the remembered scene |
| `device-mode-set`, `power-set`, `brightness-set`, `scene-activate` | command | Work, Quiet and Free; power, brightness and scenes |
| `moment-play`, `zone-power-set`, `media-start`, `media-control` | command | Refused with `unsupported-capability` (moments are codex-nanoleaf#158) |
| `nanoleaf-wall-edit` | command | One edit from the wall editor: settings and palette, element projects and halves, a task's project, a project's color, Locate, an eviction |
| `nanoleaf-machine-edit` | command | One map edit from a machine, guarded by `expectedConfigurationRevision` |
| `nanoleaf-animation-play` | command | A preset, a favorite or a recipe, on the Lines in Free |
| `nanoleaf-favorite-edit` | command | Save, rename or forget a Lines favorite |
| `nanoleaf-notice-acknowledge` | command | Acknowledge a finished turn the wall shows, for consumer `nanoleaf` |

## Commands and outcomes

- **Admission** runs in the module's outbox transaction. It applies the port's domain
  checks (content in Free only, animations on the Lines only, one waiting animation, 32
  waiting native commands, `validFavoriteEdit`, the effect rules) and `commandSupported`,
  and refuses a stale `expectedConfigurationRevision` or `expectedGeneration` with
  `revision-conflict`. A refusal, or a store failure, rolls back and is the reply.
- **Outcomes.** An accepted command commits its journal row before the `accepted` reply
  and ends with one outcome through the outbox, in the command's trace, with the
  registry's error detail. The worker's writes end native commands and animations; edits
  and favorites end in their admission's transaction.
- **A device that answers with an error.** A device that answers a write with an HTTP
  error status heard it and refused it: the command fails with evidence `transmitted` and
  the code for the status (401 `unauthenticated`, 403 `forbidden`, 404 `not-found`, 409
  `invalid-state`, 429 `capacity`, 5xx `unavailable`, any other `invalid-request`). Nothing
  holds the device, and the pass starts again without the command.
- **Modes.** A mode is the module's own state, so, as the epic's coordinator decided on
  #844 and PR #968, a `device-mode-set` commits its mode, ending the device's queued work,
  its hold and its overrides, and completes `succeeded` with evidence `observed` in its
  admission's transaction, whether or not the device answers. Nothing is sent to the
  device as part of it, so it has no expiry: the worker paints the mode as the module's
  state once the device answers, and the device's availability shows whether it has.
- **Expiry.** A device write (power, brightness, a scene, an animation) still queued at its
  expiry fails `expired`, whether or not a worker runs. It never reached the device, so it
  proves no effect and holds nothing.
- **Desired state.** A power or brightness command that fails, whether it expired, was
  refused by the device or was cancelled at a restart, takes its desired power or
  brightness with it, unless another command of its kind still waits.
- **Holds.** Only a write that may have reached the device holds it: one whose answer did
  not come, or an attempt a restart found without a result. The hold lasts until an
  explicit mode command or a fresh control (power, brightness, a scene or an animation),
  and the write is never retried. While it lasts, the device record is `degraded` and its
  `held` names the held write's request ID and the time the hold began (`device/2.1`,
  #975), the wall view shows `held`, and the module logs the hold once as it begins and
  once as it is released. The record after the release has no `held`. The journal keeps
  the held operation with the hold (`control_holds`), so a restart shows the same `held`.
- **Restarts.** Each command accepted before a restart with no outcome ends at the start
  and never runs. An attempt without a result is uncertain, and so is an acknowledgment
  whose request may have reached the core. A queued command fails `cancelled`, and so does
  a waiting machine edit. Saved comets are dropped.

## Wall-editor ownership

The wall map is the editor (ADR 0007). Each device carries a configuration revision in its
`device` and `nanoleaf-wall` records. Wall edits of settings, elements, a task's project
or a project's color, mode commands, applied machine edits, favorite edits and a selection
of shared input move it; the palette, Locate and evictions do not. Machine edits apply to
the Lines, one waiting at a time:

1. A machine edit is refused with `revision-conflict`, saying why, while a wall edit is
   pending on the device (`refusePendingWallEdit`).
2. A queued machine edit fails with `revision-conflict`, without overwriting the newer
   choice, when a later wall, mode or association edit lands first (`processMachineEdits`).
3. A machine edit waits while the device's comet runs, then applies, or fails `expired`.

## Sessions

The module follows the core's `session/2.0` records through the SDK's sync and keeps its
copy in memory only (`SessionFeed`, `SharedCopy`).

- A completed sync, the first or one after an overflow, is projected as a fresh start, so
  no comet or wave replays. Each live change is projected as one change.
- A new shared-input configuration at start pauses shared input, and the first sync
  selects it again. A step that carries the shared-input generation from before the new
  configuration changes nothing. Inside one runtime the feed's generation moves with each
  projection, so this guard is defensive there; a second runtime on the same state is kept
  out by the workers' lock files.
- A copy that stops following the core freezes the tasks until a later sync, which the
  module tries again with capped backoff.

## Concurrency

- Every transaction is synchronous, on the module's one connection; none spans an await or
  a device request, so transactions take turns by construction and nothing waits inside
  SQLite on the event loop.
- One supervised worker per device (`superviseWorker`), with its lock file in the private
  folder, which also excludes a second runtime on the same state. An accepted command
  starts its device's worker when none runs. A worker that ends on a failure, because the
  store was busy or full or another instance held its lock, starts again after a wait that
  doubles from 1 s to 30 s. One start waits at a time per device: a worker that a command
  or a selection starts meanwhile replaces it, and its end schedules the next. Meanwhile
  the device shows `degraded` and its wall view `failing`.
- Each device request goes through the device's link (`DeviceLink`), which settles within
  1.2 s on the module's scheduler and abandons a request at the module's stop.
- Each worker wait is rounded up to the runtime scheduler's whole milliseconds.
- The views are built on the event loop whenever a request settles, so the saved layout,
  its geometry and the remembered scene are read again only when their file changes.
- The lock files, `notification-lock*.sqlite` and `layout-lock.sqlite`, are created with
  mode 600, so their journals are private too.

## State and availability

The `device/2.1` record is published only when it changed (ADR 0012: a poll that changed
nothing publishes nothing). Its observation is the power and brightness the device
reported to `GET /state`, with `observedAtMs` the time of the reading that first showed
them; consumers judge freshness by `availability`, as for the playback and LIFX records.
The module reads `GET /state` every 5 s while the device answers and backs off to 30 s
while it does not; once the device answers any request again, the next read comes within
5 s. `lastTransmission` is the last write that reached the device, the module's own paints
included, with the command's request ID when the write served one; a write the device
answered with an HTTP error reached it, so it counts. The module keeps it apart from the
last outcome and saves it (`nanoleaf_transmissions`), so an outcome that sent nothing, a
poll and a restart leave it as it was. A change that includes a command's write is
published at once. A change from paints alone is published at most once every 5 s
(`TRANSMISSION_MS`): the record is built again as each device request settles, so a later
paint shows with the first request after the interval. That is within one 5 s poll while
the device answers; once it stops answering, the poll shows it as it times out, up to
1.2 s later. Availability is:

- `unavailable` while the device does not answer;
- `degraded` while it answers and the module does not present it: it refuses the module's
  token (401 or 403), its last pass failed, a hold stops its writes, which `held` names,
  or no worker runs;
- `available` otherwise, once it has answered; `unknown` before.

## Failures and logs

A device's errors and timeouts are outcomes and the device's availability, never module
failures (policy A); no scheduler callback throws. The module logs registered module
events only: `device.unavailable` once as an outage begins and `device.available` once as
it ends, with DEBUG summaries between; `operation.failed` once per run of other failed
passes, a device refusing the module's token (one record, the link's, not one per failed
pass as well), a hold, a worker that ended on a failure (each later end of the run at
DEBUG), a failed publication (`bunny.operation` `snapshot`, tried again each second so the
records reach readers within a second of the store reading again, where the next poll
could be 5 to 30 s away) or a failed session sync, and `operation.completed` at each
recovery, a failed pass's only once a worker presents the device again; `feed.changed`
when shared input is selected; and its outbox's `outcome.published` and `outbox.deferred`.
Each device write made for a command records a `bunny.device.call` span in that command's
trace. Records hold codes, error types and IDs, never an exception's message, an address
or a token. The port's own error messages may quote input, so none reaches a record or a
body.

## Simulated controllers

`SimulatedNanoleaf` answers the local API's requests as a Lines (six Lines) or NL22
(four triangles) controller would, accepts only the synthetic token `tok_SYNTHETIC919`,
keeps its state across a runtime restart, and can go offline, hold its requests, lose a
write's answer, answer a write with an HTTP error, lose a saved scene, take another token
or be switched off as the Nanoleaf app would. With `anyAddress` it answers
every address a configuration names; the shipped runtime's `--simulate` build uses that.

## Checks

From the repository root, with Node 24: `npm run test:nanoleaf`, which builds and runs
every suite in `dist/tests/`, the port's translated and recorded tests, the module's
(`module.test.ts`, and `module-faults.test.ts` for its faults and recoveries), its module
test kit run (`module-kit.test.ts`), the journal's outcome errors and the migration (`migration.test.ts`). The runtime's `nanoleaf.test.ts`, the catalog's `nanoleaf-wall` scenario
and its disposable run cover the module under the runtime. See
[Nanoleaf port](../../docs/development.md#nanoleaf-port).
