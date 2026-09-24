## Context

The standalone hub is a single Node 24 process in WSL. It already composes the agent-state owner, bounded loopback controller clients and an optional read-only Codex Desktop poller, all behind one authenticated loopback listener. The #158 qualification established that WSL reaches the HT-A9 Audio Control API at `http://<receiver>:10000/sony` over unicast HTTP. It also found that `getPlayingContentInfo` reports AirPlay title, artist, album and `PLAYING`/`PAUSED` state, and that `pausePlayingContent`, `setPlayNextContent` and `setPlayPreviousContent` reached the phone. Previous restarted the current song. Position, duration and a play/resume command were not established. Push notifications and artwork are out of scope for this change.

## Goals / Non-Goals

**Goals:** a shared playback module that no source protocol leaks into; a Sony source with documented polling and freshness; authenticated snapshot and command routes with sent/failed/uncertain results, one command at a time and bounded duplicate suppression; an extension path for later sources that needs no rewrite of the shared module or consumer contract.

**Non-Goals:** a second production source, multi-source runtime or selection UI, plugin discovery, WebSocket subscriptions, SSE, artwork, progress, track identity or song-change events, persistence, MCP tools and dashboard UI.

## Decisions

### Module boundary

- `apps/hub/src/playback.ts` is the shared module. It exports the `PlaybackSource` interface, the observation and action types and `createPlayback(source, clock)`. It owns the last observation, freshness, the snapshot, command validation, the command slot, duplicate suppression and receipts. It imports nothing source-specific.
- `apps/hub/src/sony.ts` is the Sony source. It validates the receiver endpoint, polls, parses JSON-RPC replies, normalizes Sony fields and maps actions to Sony methods. Raw responses, method names and the endpoint never leave it.
- `server.ts` composes them. It validates the `playback` configuration envelope, builds the source for its `kind`, starts the shared module after the listener is ready, routes requests and closes playback before the agent-state owner shuts down.

The source interface is intentionally small:

```ts
type PlaybackSource = {
  readonly id: string;
  start(report: (observation: PlaybackObservation) => void): void;
  command(action: PlaybackAction): Promise<'sent'|'failed'>;
  close(): Promise<void>;
};
type PlaybackObservation = {status: 'playing'|'paused'|'stopped'|'inactive'|'unknown'; title?: string; artist?: string; album?: string; controls: PlaybackAction[]};
type PlaybackAction = 'play'|'pause'|'next'|'previous';
```

A source reports every successful observation, including unchanged ones, and never reports a failed read. `command` resolves `sent` when the source accepted the call and `failed` only when the source refused it before any effect. A rejection means the result is uncertain. The source owns its own timeouts.

### Configuration

Optional `playback` is `{selected, sources}`. `sources` currently holds exactly one entry, and `selected` must name it. A Sony entry is `{id, kind: "sony", endpoint}`. `id` is a user-chosen neutral ID that becomes the stable `sourceId`. It must not equal a controller alias or `hub-service`, because it shares the credential `devices` list with controller aliases. `endpoint` must be exactly `http://<numeric private or loopback IPv4>:<port>/sony` without credentials, query or fragment. The receiver address never comes from a request.

### Freshness

The shared module stamps each reported observation with the hub clock. With age measured from the last successful observation:

| Availability | Rule | Snapshot `playback` |
| --- | --- | --- |
| `available` | age under 5 seconds | last observation |
| `stale` | age from 5 to under 30 seconds | last observation, kept for context |
| `unavailable` | never observed, or age 30 seconds or more | `null` |

At a two-second poll, `stale` means about two missed reads. A missing observation never becomes `paused` or `stopped`. The snapshot is `{apiVersion: "1.0", sourceId, availability, observedAtMs, ageMs, playback}`; `observedAtMs` and `ageMs` are `null` before the first observation.

### Sony polling and normalization

The source reads `avContent.getPlayingContentInfo` version 1.2 immediately on start, then every two seconds. Each request has a 1.5-second timeout and a 64 KiB response limit. A read in progress is reused rather than overlapped. The result may be a list of per-output entries or a list containing one such list. The source selects the entry whose `source` is `extInput:airPlay`:

- No AirPlay entry means another input is active: status `inactive`, no metadata and no controls.
- `stateInfo.state` maps `PLAYING`, `PAUSED` and `STOPPED` to `playing`, `paused` and `stopped`; any other value becomes `unknown`.
- Non-empty `title`, `artist` and `albumName` become `title`, `artist` and `album`, trimmed and limited to 256 characters. Missing fields stay absent. No other Sony field, including the thumbnail URL, is copied.
- Controls are `pause`, `next` and `previous` only while playing, the state in which they were qualified. `play` is never declared.

A JSON-RPC error, non-200 status, mismatched reply ID, malformed body, timeout or network error is a failed read and reports nothing.

### Commands

`POST /api/playback/v1/commands` takes exactly `{requestId, sourceId, action}`. Checks run in this order, and none of them contacts the receiver:

1. Shape: `requestId` and `sourceId` are neutral IDs and `action` is a known action; otherwise `invalid-input` 400.
2. The caller's credential must list `sourceId` in `devices`; otherwise `forbidden` 403.
3. `sourceId` must be the selected source; otherwise `unknown-source` 404.
4. A retained `requestId` from the same principal returns its original receipt when the body matches, or `request-conflict` 409 when it differs.
5. The selected source must be `available`; otherwise `source-unavailable` 503.
6. The action must be in its current controls; otherwise `unsupported-control` 422.
7. Only one command runs at a time; otherwise `capacity` 429.

An admitted command calls the source once. The receipt is `{requestId, sourceId, action, outcome}` with HTTP 200 for `sent`, 502 for `failed` and 503 for `uncertain`. The Sony source returns `sent` for a JSON-RPC result and `failed` for a JSON-RPC error; anything else, including its 1.5-second timeout, is uncertain. Nothing is retried. Receipts are kept for the latest 64 admitted commands per hub process; only the newest can still be pending, so eviction never drops a pending entry. A restart clears them and nothing replays.

### Routes and authority

`GET /api/playback/v1/snapshot` needs `read` scope and the selected source ID in the credential's `devices`. The command route needs `control` scope, `X-Pixoo-Request: 1` and the same device grant. Both reuse the hub's Host, Origin and fetch-metadata checks. A staged host still serves snapshots but rejects commands with `owner-quiesced`, so a migration destination is not a second writer. Browser launch sessions receive no playback grant until #37 adds UI. Playback state is separate from agent sessions, exports and the monitor change feed.

### Future two-source flow

This change does not implement it. A second source would work like this:

1. Configuration lists both sources, for example a Sony receiver `living-room` and a later Windows player `desk`, with `selected: "living-room"`. Each adapter implements `PlaybackSource` and reports only its own observations.
2. The shared module keeps one observation and freshness record per source ID, created exactly as the single record is today. A newer observation from `desk` updates only `desk`.
3. The snapshot route keeps its current shape for the selected source. A separate list of all sources can be added beside it without changing existing fields.
4. Commands already carry `sourceId`. A command for a source that is not selected is rejected, never redirected. A command for the selected source goes only to that adapter.
5. If `living-room` becomes unavailable while `desk` plays, the snapshot reports `living-room` as unavailable. Nothing switches until an explicit selection change, such as a configuration edit or a later authenticated selection command, names `desk`.

The AC1 test drives a non-Sony fake source through the unchanged shared module to show that the interface does not depend on Sony.

## Privacy

The receiver address stays in the owner-only configuration file and is not returned by any route or error. Snapshots contain the current title, artist and album for authenticated local clients only. They are not logged, persisted or included in agent-state exports. The thumbnail URL, which embeds the receiver address, is dropped.

## Failure and recovery

Polling failures leave the last observation to age through `stale` into `unavailable`. The next successful read restores `available` without a reconnect step, because each read is an independent HTTP request. Closing the hub stops the poll timer, aborts in-flight requests and waits for the current read. An uncertain command keeps its receipt so a client retry with the same `requestId` does not resend it. Pause may have reached the phone even when the result is uncertain; a new `requestId` is required to try again.

## Risks / Trade-offs

- Polling adds about two seconds of latency compared with the qualified push feed. This is acceptable for text metadata; #39 can add push later if song-change timing needs it.
- The exact `getPlayingContentInfo` result nesting on the HT-A9 was not recorded in #158. The parser accepts both documented shapes, and the installed check (AC5) confirms the live shape.
- Declaring controls only while playing means next and previous are unavailable while paused. This follows the qualified evidence and can be widened after a paused-state check.
