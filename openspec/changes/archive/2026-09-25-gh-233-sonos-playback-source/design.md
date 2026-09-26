## Context

See proposal.md (Why). The shared module from #175 keeps one observation for one configured source and serves `GET /api/playback/v1/snapshot` and `POST /api/playback/v1/commands` for it. The Sony source polls `getPlayingContentInfo` every two seconds. The dashboard, the MCP playback tools and the Tidbyt and Pixoo now-playing cards all pin the configured source ID, and the two card parsers reject a snapshot with any key outside the 1.0 shape. The #158 and #242 checks recorded the Move's AVTransport behavior: `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions` answer within tens of milliseconds, the AirPlay track URI uses the `x-sonos-vli` scheme, `Pause` and `Play` (speed 1) act within 0.5 seconds, and the action list reads `Set, Stop, Pause, Play, Next, Previous` while playing and while paused.

## Goals / Non-Goals

**Goals:** show and command whichever speaker the phone is playing to, without a configuration change; keep every existing consumer working unchanged; keep each source's protocol in its own module; never send a command to a source that is not presented.

**Non-Goals:** a runtime selection command, exposing the active speaker in the snapshot, position and duration, artwork, UPnP event callbacks, discovery, grouped-speaker modelling beyond what the preference rule gives, and any UI change.

## Decisions

### One stable playback ID

Configuration is `{"id": "<neutral ID>", "sources": [...]}`. `id` is what every client sees: the `sourceId` in snapshots and receipts, the credential device grant, the MCP tool prefix and the dashboard context. It must differ from every controller alias and `hub-service`, must not look like an IPv4 address and must not contain any configured endpoint address. Source entries have no ID of their own; `kind` identifies them because at most one entry per kind is allowed. The old `selected` form is rejected with `invalid-playback`, so an operator upgrading an installed hub edits the file once and keeps the existing ID (`ht-a9` on the installed hub), leaving credentials, the Tidbyt `nowPlaying` block and the Pixoo card untouched. The alternative, a snapshot whose `sourceId` follows the active speaker, would blank both cards and block the dashboard's fresh-read command builder.

### Preference rule

The shared module keeps one observation and freshness record per source, created exactly as the single record was. Each snapshot and command computes the presented source as the first source, in configured order, with the highest rank:

1. reports a session: its latest observation is retained (not unavailable) and its status is `playing` or `paused`;
2. freshness class: `available` over `stale` over `unavailable`;
3. configured order.

Consequences: the Move alone or grouped with the HT-A9 presents the Move (both report a session, both available, the Move is first); the phone on the HT-A9 alone presents the HT-A9 because the Move reports `inactive`; a Move that stops answering mid-song stays presented as `stale` with its last track for up to 30 seconds, then its record becomes unavailable and the HT-A9 is presented. `stopped`, `inactive` and `unknown` are not sessions, so a Move that still shows a stopped AirPlay track does not outrank a playing HT-A9. An unrecognized transport state ranks as no session; whether the Move reports `TRANSITIONING` during AirPlay is unobserved and the live check watches for it. The snapshot's `availability`, `observedAtMs`, `ageMs` and `playback` are the presented source's.

### Commands follow the presented source

The command route keeps its checks and order. `sourceId` must equal the playback `id`; any other value is `unknown-source`. The presented source at admission must be `available` and must declare the action; the command then goes to that source once. One command runs at a time across all sources. A client that read the Move's controls just before the rule switched to the HT-A9 gets `unsupported-control` for `play`, because the check uses the presented source's current controls; nothing is redirected.

### Sonos source

`{"kind": "sonos", "endpoint": "http://<private IPv4>:1400/MediaRenderer/AVTransport/Control"}`. The endpoint is the exact control URL with a numeric private or loopback address, a port and no credentials, query or fragment. Every two seconds, and once on start, the source sends three SOAP calls in sequence with `InstanceID` 0, each with a 1.5-second timeout and a 64 KiB reply limit: `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions`. A read in progress is reused. Any non-200 reply, malformed body or missing field fails the whole read, which reports nothing.

- `TrackURI` with the `x-sonos-vli` scheme is the AirPlay session. Any other URI, or none, reports `inactive` with no metadata and no controls.
- `CurrentTransportState` maps `PLAYING`, `PAUSED_PLAYBACK` and `STOPPED` to `playing`, `paused` and `stopped`; anything else is `unknown`.
- `TrackMetaData` is DIDL-Lite XML escaped inside the SOAP body. The source unescapes it once, reads `dc:title`, `dc:creator` and `upnp:album`, unescapes their text, trims it and limits each to 256 characters. Missing or `NOT_IMPLEMENTED` metadata leaves the fields absent. `albumArtURI`, `RelTime` and `TrackDuration` are not copied.
- Controls intersect the advertised `Actions` with the state: playing declares `pause`, `next` and `previous`; paused declares `play`, `next` and `previous`; other states declare nothing. Next and previous while paused follow the device's own declaration and the HT-A9 precedent; the live check confirms them on the Move.
- Commands send `Pause`, `Play` with `<Speed>1</Speed>`, `Next` or `Previous`. HTTP 200 is `sent`; an HTTP 500 carrying a SOAP fault is `failed`; anything else, including the timeout, rejects and is reported `uncertain`.

XML is read with a small bounded element extractor for the handful of known elements rather than a dependency; the reply is already limited to 64 KiB.

### Module boundary

`playback.ts` exports `PlaybackSource` without an `id` and `createPlayback(id, sources, clock, monotonic)`. `sony.ts` and `sonos.ts` each validate `{kind, endpoint}` and own their protocol. `server.ts` validates the envelope, builds each source for its `kind`, rejects duplicate kinds and closes every source with the host; a source whose `close()` fails does not stop the others from closing, and the first error is reported afterwards. `common.ts` gains the shared private-address check, bounded text reading and the metadata text limit.

## Privacy

Both endpoints stay in the owner-only configuration file. Neither the snapshot, a receipt nor any error names an address or the active speaker. Metadata goes only to authenticated local clients and is not persisted or exported.

## Failure and recovery

Each source's failed reads leave its own record to age through `stale` into `unavailable`. The preference rule reads the records at each request, so recovery needs no reconnect step. Closing the hub stops both poll timers, aborts in-flight requests and waits for each current read. Receipts and the single command slot are unchanged.

## Migration Plan

Edit the installed `host.json`: replace `"selected": "ht-a9"` with `"id": "ht-a9"`, drop the `id` from the Sony entry and add the Sonos entry first. Restart the hub. Credentials, the Tidbyt `nowPlaying` block and the Pixoo card keep `ht-a9`. Rollback is the previous archive with the previous file. No stored state changes.

## Risks / Trade-offs

- [A source in an unrecognized state ranks as no session] → a possible one-poll flip to the HT-A9 in the grouped case if the Move reports `TRANSITIONING` between AirPlay tracks; unobserved so far, watched in the live check.
- [Three SOAP calls per poll] → about 30 ms on the LAN per the recorded timings; reads are sequential and never overlap.
- [Paused next and previous unconfirmed on the Move] → declared from the device's own action list and named as unconfirmed in the guide until the live check.
- [Old configuration stops the hub] → a loud `invalid-playback` with a documented one-time edit, instead of a `selected` key whose meaning silently changed.
