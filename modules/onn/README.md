# ONN controls and title history

The ONN module controls one manually configured Android TV device through a
private Google ADB server. It contributes its React remote to the shared
dashboard and uses the core dispatcher for authenticated HTTP and MCP commands.
When enabled, the same owner collects private title observations through a fixed
read-only Java/Dex MediaSession reader. TypeScript owns the schedule, leased
database, authenticated reads and dashboard contributions. The
[history contract](../../docs/onn-history-qualification.md) defines this scoped
native dependency and the retained feature boundary.
The [qualification record](../../docs/onn-controls-qualification.md) names the
selected route, observed app behavior and limits. Source checks do not establish
installed or physical acceptance.

The remote provides Up, Down, Left, Right, Select, Back, Home, play/pause and
standard YouTube/Stremio shortcuts. Focus the TV's text field before inserting
text. Supported input is ASCII letters, digits, spaces, dots, underscores and
hyphens, with a maximum of 256 characters; it never submits a search. Other
characters are refused before device work. Power, volume and direct seek keys
are unsupported.

To seek, focus the timeline on the TV and press Left or Right individually.
YouTube needs a separate Select to apply its marker; Stremio applies the step
while paused. The module does not infer focus or combine presses into a macro.
An app shortcut resolves the selected installed LEANBACK activity and launches
it once. It does not select a title.

## Private setup

The `modules.onn` section contains only these fields:

| Field | Required value |
| --- | --- |
| `id` | One neutral routing ID, such as `onn`; lowercase letters/digits separated by hyphens, at most 128 characters. |
| `configurationRevision` | Positive integer; advance it when the selected setup changes. |
| `adbSocket` | Exact absolute Unix socket path, at most 100 bytes; owner-only socket (`0600`) inside an owner-only directory (`0700`). |
| `serial` | Actual device IPv4 address and current Wireless debugging connection port. |
| `hostExecutable` | Exact absolute path of the qualified Google platform-tools executable; owned regular executable, without group/other write permission. |
| `hostExecutableSha256` | SHA-256 of that executable, recorded during setup. |
| `hostVersion` | Qualified platform-tools version, `37.0.1`. |
| `hostKeyDirectory` | Exact owner-only directory (`0700`) containing the privately paired `adbkey` regular file (`0600`). |
| `historyEnabled` | Optional boolean, default `false`. Enables continuous title collection; disabling it preserves retained history. |

Pair manually using the actual address and ports shown on the device. The
pairing-code dialog and the main connection page use different ports. Device
settings, pairing and physical checks need an owner-approved sequence. Keep
codes and keys private. The module never starts, stops, discovers or replaces
an ADB server, and never changes ports or switches transports automatically.
If the configured dependency is missing or unsafe, it reports unavailable.
Collection also requires the release-pinned artifact at the fixed
`/data/local/tmp/bunny-onn-metadata/<reader-sha256>.dex` path. Its source,
release identity and build checks live under `native/`; TypeScript pins are in
`src/reader-artifact.ts`. A separately approved device setup deploys that exact
file. Polling checks it and invokes it once; it never copies, repairs or installs
an artifact. This is not an APK or resident Android service and needs no new
device permission. Missing, mismatched or refused reader output creates a gap.
The fixed invocation supplies the reader's result pipe before forwarding to
raw ADB's socket-backed output. It preserves reader failure status with
`pipefail` and suppresses VM startup stdout/stderr. Neither the result path nor
the invocation accepts client-supplied arguments.
Module startup opens its private store and bus resources without waiting for
the device.

## State and outcomes

`device/2.1` provides shared identity, availability, pending work and last
outcome. `onn-state/2.0` provides the connection generation, current app and
qualified controls. Read-only polling every five seconds reports only
`youtube`, `stremio`, `other`, `none` or unknown; raw package names and private
paths never appear in state. Current-app observations become stale after
15 seconds. App launch transmission does not prove the foreground app changed.
Commands update connection state from reachability evidence with their outcome.
A local refusal preserves that state; unchanged offline polls publish no new
state, while a fresh timestamped app observation remains new evidence.

The queue holds at most 16 accepted pending actions including the in-flight
action. One action has a five-second whole-operation deadline, shortened by
its remaining expiry. Admission commits a durable fence before any effect.
Success with transmitted evidence reports a successful protocol transmission;
only observation of the TV establishes its visible effect. A lost reply after
a possible write remains uncertain. There is no automatic action retry,
replay, compensation or fallback.

Private SQLite fences, outcomes and the SDK outbox survive restart. Interrupted
accepted work becomes failed; interrupted started work becomes uncertain.
Neither is reconstructed or executed again. Outbox republication only reports
the retained outcome. A matching request ID returns its retained admission;
changed semantic input conflicts. Two deliberate presses use distinct IDs.

Focused text remains in memory only. Both core and module admission retain a
stable private HMAC, never plaintext or an unkeyed text hash. Each owner pins
its key identity in its leased database. A missing, replaced or unsafe key
refuses new text, retries and queued text at its final effect check, preserving
old fences. Do not replace a key to
recover a request. The dashboard clears submitted text immediately; it keeps
no text in browser storage. Inbox Send again refuses omitted input before
handling the original item; Dismiss remains available. Enter fresh text with
a new request ID for another deliberate insertion.

## History on the dashboard

The ONN controls page also shows current content and retained title history.
Current content follows the existing owner sync and distinguishes fresh,
stale, unavailable and disabled collection. Leaving supported playback clears
the previous title. YouTube observations retain the selected-title label,
including possible ad timing; position and duration are source values.

Submit app, title and local calendar dates to browse retained occurrences.
From date includes its local midnight; Through date includes that whole local
day and ends at the following midnight, including DST changes. Each page holds
up to 50 entries. Continue with the same submitted filters, or refresh to start
a new evidence cutoff. View observations opens the contributing records and
their source details. Unknown identity, omissions and collection gaps remain
visible. Filters and replies stay in page memory.

`history-types.ts` and `metadata-types.ts` contain the shared browser-safe
fields. The frontend uses those local types and closed document guards; it
imports no server implementation or runtime schema compiler. Browsing,
filtering, paging and reconnecting send no device command.

## MCP and verification

`onn_status` is a read-scoped cached status tool and sends no control.
Control-scoped clients use `core_send_command` with `onn-key-press`,
`onn-app-open` or `onn-text`, the configured target and the corresponding
`key`, `app` or `text`. HTTP uses the same families at
`POST /api/v2/commands/<family>`. Optional shared configuration/generation
guards prevent work against stale setup. No action accepts a package, URL,
socket path, device address or arbitrary shell string.

`onn_history` and `onn_history_detail` read the same retained data as authenticated
`GET /modules/onn/content/history` and `history-detail`. The `history-state`
content reference and `onn-history-state/2.0` sync family expose collection
status, latest source values, freshness, omissions and coverage. Reading sends
no device command or metadata poll.

History accepts optional `app` (`youtube` or `stremio`), `fromMs` (inclusive),
`toMs` (exclusive), `title`, `limit` and `cursor`. Times filter explicit host
receive timestamps. Detail requires a local `id` such as `occ-1` and accepts
`limit` and `cursor`. HTTP numeric parameters are decimal integers; MCP uses
integers. Pages default to 50, permit at most 100 entries and scan at most 500
evidence candidates. Ordering follows immutable evidence sequence, so clock
changes cannot reorder a cutoff page. Reuse the same filters and limit with a
returned cursor. An empty filtered page can still have continuation. Detail
pages retain contributing observations at the same cutoff.

Retained gaps and observations follow that cutoff. `storageAvailable` and
`pendingGap` report the collector's current known storage health, including a
failed intake not yet persisted, even when reading an older cutoff page. A
successful recovery persists the gap and clears the pending failure.

Each accepted original projection is retained privately and indefinitely in the
module's existing database, including intake/run/poll identity, host/device
times, reader identity and omissions. Stable source IDs can group continuous
observations; absent or ambiguous identity stays explicit and titles alone never
join records. Startup, unavailable, busy and clock gaps retire continuity.
Storage loss refuses intake, keeps earlier originals and exposes a pending gap
until it can be recorded durably. Collection reads yield to controls and share
their five-second operation deadline. No command is reconstructed or replayed.

Current data becomes stale after 15 seconds. Unavailable and disabled states may
include explicitly last-observed data; an accepted empty sample clears current
content. State and query projections limit each text field to 512 UTF-8 bytes
and responses to 128 KiB, reporting projection/continuation loss. Originals
remain intact. The source permits eight sessions, 8192 bytes per text field and
256 KiB per reply; these finite limits and collection gaps remain visible.

YouTube records mean **selected title observed**. An ad can expose the selected
video's identity with ad timing. Stremio records retain available series/episode
strings and reported progress. Neither source proves attention, watched minutes
or completion. Position and duration are reported values, without extrapolation.
Recognized authorization/password/token assignments and authentication-bearing
URL components are excluded before retention; ordinary surrounding text and
URLs remain. This narrow syntax detection cannot certify arbitrary prose as
secret-free. Collected titles, observations and diagnostics remain private and
must never be published to GitHub.

`npm run test:onn:native` needs JDK 21 and Python 3.12 or later. It compiles the
reader against synthetic Android surfaces and checks source/Dex pins. To
reproduce Dex offline, supply the already qualified R8 8.3.37 jar as
`ONN_R8_JAR` and run `python3 modules/onn/native/rebuild.py` from the repository
root. The script verifies all pins, compares generated Dex and removes its own
temporary output; it neither downloads tools nor replaces the shipped artifact.
Default CI proves JDK behavior and pin consistency, with no Android or D8
execution claim.

Use the [development checks](../../docs/development.md#onn-module-checks).
The simulation supplies synthetic titles, episodes, progress, physical changes,
gaps and an effect count. Native/protocol/source tests do not establish installed
reader or physical acceptance. Watched-time totals/completion, advertisement
classification/Skip, topic inference, recommendations and exact-title launch
remain deferred or optional; no Google TV-link source is selected.
