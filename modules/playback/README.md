# Playback module

Private workspace package `@jimmie-potts/playback`: the runtime module that
follows and controls what the speakers play
([Hub #929](https://github.com/jimmie-potts/agent-device-hub/issues/929)). One
module owns both the Sony HT-A9 and the Sonos Move, because the presented-source
rule ([#233](https://github.com/jimmie-potts/agent-device-hub/issues/233)) needs
both sources in one owner, and modules cannot import each other
([ADR 0012](../../docs/decisions/0012-bunny-event-platform.md)). It is in the
runtime's shipped list (`apps/runtime/src/modules.ts`). Nothing installs it until
the cutover ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)).
The old Hub keeps its own copy until the retirement
([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)).

The owner's iPhone plays Apple Music over AirPlay to one speaker or to both. The
module reads what is playing and can send play, pause, next and previous. No
audio passes through it. The
[qualification record](../../docs/iphone-apple-music-qualification.md) documents
the speaker behavior it relies on.

## Provenance

Copied from the old Hub at main `483d3a93` (2026-10-07) and converted to the
[strict profile](../../docs/development.md#strict-profile-for-new-code):

| Source | Here | Change |
| --- | --- | --- |
| `apps/hub/src/playback.ts` | `src/playback.ts` | Keeps the observations, freshness and presented-source rule. Command admission and receipts moved to `src/module.ts`. |
| `apps/hub/src/sony.ts` | `src/sony.ts`, `src/transport.ts` | The HTTP call moved to `transport.ts`, and polling and deadlines to the module. |
| `apps/hub/src/sonos.ts` | `src/sonos.ts`, `src/transport.ts` | As for the Sony. |
| `apps/hub/src/common.ts` (part) | `src/common.ts` | `privateHttpEndpoint` returns `undefined` instead of throwing. |
| `apps/hub/tests/playback.test.mjs` | `tests/*.test.ts` | See [Tests](#tests). |

## Configuration

The module's section of the runtime's
[configuration file](../../apps/runtime/README.md#configuration)
([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919)):

```json
"playback": {
  "id": "living-room",
  "sources": [
    {"kind": "sonos", "endpoint": "http://192.168.1.30:1400/MediaRenderer/AVTransport/Control"},
    {"kind": "sony", "endpoint": "http://192.168.1.20:10000/sony"}
  ]
}
```

- `id` is the playback record's routing ID: lowercase letters and digits with
  single hyphens, at most 128 characters. Every client sees it, and it never
  changes with the presented speaker, so it must not be a track name or a
  speaker's address. The module names it as its one device, so the runtime
  refuses another module that names the same ID.
- `sources` lists one or two speakers in preference order, at most one of each
  kind. A Sony endpoint is `http://<private or loopback IPv4>:<port>/sony`. A
  Sonos endpoint is the exact AVTransport control URL,
  `http://<private or loopback IPv4>:<port>/MediaRenderer/AVTransport/Control`.
  Neither may have credentials, a query or a fragment.
- A `secrets` member is allowed and unused, because the speakers take no
  credential.

Any other section is refused with `invalid-request` and a fixed detail that
repeats no value. Health then shows the module `refused`, and the runtime runs
the others. Without a section the module is refused with `not-found`. The
speaker addresses stay in the private configuration file: no message, record,
error body or health entry carries one.

### Conversion from the old Hub

`convertHostPlayback(block)` converts the old Hub's `host.json` `playback`
block, `{id, sources}`, into this section. The cutover's installer
([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)) runs it.

- It checks the block as the Hub did at its start, apart from the Hub's own
  aliases.
- It keeps both speakers' addresses in their configured order.
- A 1.x ID outside the routing-ID form is renamed by `routingIdOf`: lowercased,
  each run of other characters a single hyphen, and `playback` if nothing is
  left. `HT-A9` becomes `ht-a9`, and `living_room.1` becomes `living-room-1`.
  The result's `renamedFrom` names the old ID, so the installer can report the
  rename ([MAPPING.md](../../packages/event-contracts/MAPPING.md#playback-snapshot)).
- The Hub saves no playback preference beyond the configured order, so nothing
  else is carried: the configured order applies from the first start (owner
  decision 10, 2026-10-06).

A block the Hub would refuse is refused with fixed text.

## The `playback` record

This is what the Pixoo Now Playing cards
([#843](https://github.com/jimmie-potts/agent-device-hub/issues/843)) and the
Tidbyt now-playing tile ([#930](https://github.com/jimmie-potts/agent-device-hub/issues/930))
read. It is the core family `playback/2.0`
([`packages/event-contracts`](../../packages/event-contracts/README.md)).

| What | Value |
| --- | --- |
| Owner and source | `bunny/modules/playback` |
| Sync family | `playback`: one record, the configured ID |
| Routing key | `bunny.state.playback.<id>` |
| Type | `org.bunny.playback.updated`, kind `state` |
| `dataschema` | `https://bunny.invalid/events/playback/2.0` |
| Subject | the record's `id` |

A consumer syncs `playback` from the module and then follows live state
messages. The record's fields:

- `id`: the configured routing ID.
- `revision`: rises with every change, across restarts too, because the module
  keeps the last revision in its own database.
- `availability`: the presented speaker's freshness. It is `available` while its
  last successful read is under 5 s old, `stale` from 5 s to under 30 s, and
  `unavailable` at 30 s or more or before the first read. Age is the larger of
  the wall-clock and monotonic ages.
- `observedAtMs`: the presented speaker's last successful read when the
  revision was published. It is present whenever the speaker was ever read.
- `playback`: `{"status": "unknown"}` while unavailable, so old metadata is
  withheld and nothing looks paused for lack of evidence. Otherwise it is
  `{"status": "known", "player", "title"?, "artist"?, "album"?, "controls"}`:
  - `player` is `playing`, `paused`, `stopped`, `inactive` (another input) or
    `unknown`;
  - title, artist and album are trimmed, at most 256 characters, and absent
    rather than empty;
  - `controls` are the actions the speaker offers now.

The module publishes a new revision only when `availability` or `playback`
changes. A read that changes nothing else publishes nothing, so `observedAtMs`
can be older than the last read. Judge freshness by `availability`: the module
publishes the change to `stale` and to `unavailable` when the last read
crosses each threshold. Each start publishes a new `unavailable` revision,
then the first read's.

### Which speaker is presented

A speaker ranks first by reporting a session (a retained observation that is
`playing` or `paused`), then by freshness (`available`, then `stale`, then
`unavailable`), then by configured order. So:

- with the Move first, the Move is presented while both play;
- a Move that goes silent mid-song stays presented as `stale` for up to 30 s,
  with its song, and commands are refused meanwhile;
- with nothing playing, the freshest speaker is presented.

The record never says which speaker is presented.

### What each speaker offers

- **HT-A9:** pause, next and previous while AirPlay plays; only next and
  previous while paused; never play, because it cannot resume a paused AirPlay
  session ([#242](https://github.com/jimmie-potts/agent-device-hub/issues/242)).
- **Move:** pause, next and previous while playing; play, next and previous
  while paused; each only while the Move's own action list includes it.
- **Both:** a track that is not the AirPlay session is `inactive`, with no
  metadata or controls.

## Commands

`playback-control` ([#918](https://github.com/jimmie-potts/agent-device-hub/issues/918))
on `bunny.cmd.playback-control.<id>`, type `org.bunny.playback.control.requested`,
with `{requestId, action, expectedRevision?}`. `controlPlayback(id, action)`
builds one. The module checks a command in this order. No refusal reaches a
speaker:

| Answer | When |
| --- | --- |
| `invalid-request` | The subject is not the record's `id`, the action is not `play`, `pause`, `next` or `previous`, or `expectedRevision` is not an integer. |
| `unavailable` | The module is stopping. |
| `accepted`, nothing sent | The same requester sent the same `requestId` and command before: its outcome went out once. |
| `duplicate-conflict` | The same `requestId` came with another command. |
| `revision-conflict` | `expectedRevision` is not the record's current revision. |
| `unavailable` | The presented speaker is not `available`. |
| `unsupported-capability` | The presented speaker does not offer the action now. |
| `capacity` | The module could not store the command's intent. |
| `accepted` | The command was sent, and its outcome follows. |

Another playback ID has no responder, so the bus refuses it with
`unavailable`.

The presented speaker is fixed at admission: the command goes to that speaker
once and is never redirected, even when another speaker takes over while it
waits for an answer. The module stores the command's intent before the speaker
hears it, then sends it within a 1.5 s deadline:

| Speaker's answer | Outcome |
| --- | --- |
| HT-A9 JSON-RPC result, or Move HTTP 200 | `succeeded`, evidence `transmitted` |
| HT-A9 JSON-RPC error, or Move SOAP fault | `failed`, evidence `none`, `invalid-state` |
| No answer by the deadline, or any other answer | `uncertain`, evidence `none`, `uncertain-result` |

The outcome is `org.bunny.playback.control.completed` on
`bunny.event.playback-control.<id>`. It commits with the command's result in the
module's database and goes out through its
[outbox](../../packages/sdk/README.md#outbox). Then the module replies
`accepted`. Neither the module nor a repeated `requestId` sends a failed or
uncertain command again. If the runtime stopped between storing the intent and
the outcome, the next start reports that command `uncertain` ("the module
restarted before the speaker answered") and never sends it.

The module handles one command at a time: the SDK queues a second command until
the first has its outcome, and admits it against the speaker presented then. The
old Hub refused a concurrent command with `capacity` instead. A command still
queued at its deadline is refused `expired` by the bus. The module remembers the
last 64 commands; an older `requestId` counts as new.

Until the core acknowledges outcomes
([#782](https://github.com/jimmie-potts/agent-device-hub/issues/782)), every
stored outcome goes out again at each start, and the core drops the duplicates.

## Polling and failures

Each speaker is read when the module starts and then every 2 s. The HT-A9 read
is `getPlayingContentInfo`. The Move read is `GetTransportInfo`,
`GetPositionInfo` and `GetCurrentTransportActions`, in sequence. Each call has a
1.5 s deadline and a 64 KiB reply limit. A read still in progress when the next
is due is not repeated, so reads of one speaker never overlap. A failed read
reports nothing, and the speaker's last observation ages.

Under policy A (ADR 0012, "Failure isolation"), start opens only the database
and the bus and does not wait for any read. A speaker's errors and timeouts
become `unavailable` state and outcomes, never a module failure. A speaker
offline at start leaves the record `unavailable` while the module runs.

## Diagnostics

The module logs through its context under `bunny.module`. It never logs an
address, a title or an exception's text:

| Record | Level | When |
| --- | --- | --- |
| `device.unavailable` | WARN, then a DEBUG summary at most once a minute | A speaker's read fails, once per outage (`DeviceAvailability`) |
| `device.available` | INFO | A speaker answers again, with the failed attempts and the outage's length |
| `command.executing` | INFO | A command is sent to a speaker, in the command's trace |
| `outcome.published` | INFO, or WARN for failed and uncertain | The outbox publishes an outcome for the first time |
| `outbox.republished` | INFO | Each start, with how many stored messages went out again |
| `operation.failed`, `operation.completed` | WARN, INFO | The module's database refuses a commit, once per run of refusals, and recovers |

A speaker is named in `bunny.device.id` as `<id>.<kind>`, such as
`living-room.sonos`. The bus records each command's admission and reply. The
module records a `bunny.device.call` span around each command's speaker call,
the command's child. Polls have no span. No trace context reaches a speaker.

## Simulated speakers

`SimulatedSpeakers` answers both protocols the way the qualified speakers do, so
the module's own parsing runs in tests and disposable runs. Each speaker starts
answering on another input. A test or run can:

- play a track to either speaker over AirPlay, pause it, stop it or switch it to
  another input;
- make it stop answering, or answer again;
- make its next command be refused or never answered.

`state()` shows each speaker's status, the actions it received and its call
counts. The runtime's `--simulate` builds the module with them; the scenario
catalog's `speaker-playback` scenario drives them
([runtime README](../../apps/runtime/README.md#scenario-catalog)).

## Tests

`npm run test:playback` builds, then runs `test:playback:built`. The tests need
no speaker: the HTTP tests use the old Hub's fake speakers on the loopback
interface, and the module tests use `SimulatedSpeakers` on a manual clock.

- `sources.test.ts`: the Hub's Sony and Sonos observation, freshness and command
  tests, through the real HTTP transport.
- `presentation.test.ts`: the Hub's interface, ranking and monotonic-clock
  tests.
- `configuration.test.ts`: the Hub's configuration cases, the routing-ID rule
  and the conversion.
- `module.test.ts`: the module test kit, with policy A's offline check, and the
  module's record, staleness, commands, duplicates, failed and uncertain
  outcomes, both speakers offline at start, the bounded memory of commands, a
  crash between intent and outcome, and polling over HTTP without overlapping
  reads.

The Hub tests of its HTTP routes, credentials, browser launcher, dashboard
context and staged host have no counterpart here. In the runtime, the SDK
edge's grants authenticate remote parts
([#835](https://github.com/jimmie-potts/agent-device-hub/issues/835)), and the
runtime has no staged host.
