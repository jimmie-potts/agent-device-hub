## Context

The hub serves `GET /api/playback/v1/snapshot` for its one selected source. The envelope carries `sourceId`, `availability` (`available` under 5 s, `stale` from 5 s to under 30 s, `unavailable` from 30 s or before the first read), `observedAtMs`, `ageMs` (null before the first read) and `playback`. `playback` is null when unavailable, and otherwise holds `status`, optional `title`, `artist` and `album` of at most 256 characters, and `controls`. A read credential must list the source ID in `devices`.

The Tidbyt runner from #21 holds the device lease and one `TidbytController`, and runs the status publisher. The controller writes only the installation named in the private credentials file (default `agentdevicehub`). The #16 qualification established background pushes, rotation and installation removal. It did not qualify foreground takeover.

## Goals / Non-Goals

**Goals:** a readable text card in the Tidbyt rotation that follows the settled cadence and stale rules, written through the existing single queue, with the status tile unchanged.

**Non-Goals:** artwork (#229), foreground or pop-up display, scrolling, playback commands, hub changes, the Pixoo card, installation and physical verification.

## Decisions

### View

The view is a pure function of the last good snapshot, whether the latest read succeeded, and the snapshot's effective age. Effective age is the snapshot's `ageMs` plus the monotonic time since the runner received it.

- No good snapshot, `availability: unavailable`, null `playback` or an effective age of 30 s or more: nothing to show.
- `status` other than `playing` or `paused`: nothing to show. `unknown` is not shown, because the receiver's state is not known to be music.
- Otherwise a card. It is stale when `availability` is `stale` or the latest read failed.

A failed read keeps the last card, dimmed and marked `?`, until the effective age reaches 30 s. A missing read never turns into `paused`, and a stale card never turns into a removal before 30 s. The source ID in the envelope must match the configured one; otherwise the read counts as failed.

Alternative considered: treat a failed read as immediately unavailable. That would flicker the tile off during a short hub restart, while the hub itself keeps stale data for 30 s.

### Card layout

The frame is the renderer's 64×32 RGB frame, drawn with the existing 3×5 font at a 4-pixel advance, on four 8-pixel rows.

- Column 0 of row 0 holds the marker: a green play triangle, amber pause bars, or a dimmed `?` when stale.
- The text column starts at x = 5 and holds 14 characters. The title takes up to two rows, then the artist, in a blue tint, takes the rows after it, so a one-line title leaves the artist three. With no artist, the title may use all four rows. With no title, the artist starts on row 0.
- Text wraps at spaces. A word longer than a line is split. Text that still does not fit ends with `.` in the last cell.
- Text is uppercased. Accents fold to the base letter through Unicode NFD. The font gains `'`, `&`, `!`, `,`, `(`, `)`, `/` and `:`. Other characters still draw as `-`. This also affects status labels that use those characters, which now draw them instead of `-`.
- A stale card dims every color to a third.

The album is not drawn.

### Publishing

The now-playing publisher runs one evaluation at a time. A 5 s poll or a deferred timer requests the next one. Each evaluation reads the snapshot through a bounded reader, with a 3 s timeout and at most one outstanding hung read. It then builds the view and hands the frame, or nothing, to its installation writer.

The installation writer is the status publisher's former write logic, now shared:

- push when the frame differs from the last sent one, or 10 minutes after that push;
- remove when there is nothing to show and the installation may be present, first reading the installation listing when presence is unknown;
- at least 15 s between writes, doubling after consecutive writes not confirmed sent, up to the refresh period;
- no replay of a failed or uncertain write; the next write is a fresh request for the current state.

Each publisher has its own writer, so the two tiles gate independently. The controller serializes them. Their requests are built synchronously from the controller's current identities, so the two publishers never race for a request ticket.

Unlike status, where an unavailable feed never removes the tile, now-playing removes its tile when playback is unavailable. Here an absent tile means "nothing known to be playing", which is accurate.

### Installation targeting

Installation identity stays in the connection. `TidbytCloudConfig` gains `additionalInstallationIds`, with at most four IDs, each distinct and different from the default. `DisplayConnection` methods take an optional installation ID. A cloud connection given an ID outside its set returns `invalid-request` without a network call.

`tidbyt.display` and `tidbyt.remove` commands may carry an `installation` field. The controller rejects an ID the current connection does not list, as `invalid-request` before reservation. Omitting the field keeps today's behavior for the default installation. The profile becomes `tidbyt-display` 1.2.0. Holds, generations, FIFO order and receipts are shared across installations, because they belong to the device. `refresh(installation?)` reads presence for one installation. The snapshot keeps `display.installation` for the default and adds `display.additionalInstallations` with each additional installation's evidence. `reconfigure()` clears all of that evidence.

Alternative considered: a second controller for the second installation. That would create two writers and two hold states for one device.

### Runner configuration

The runner configuration may add:

```json
"nowPlaying": {"tokenFile": "/absolute/private/playback-read-token", "sourceId": "ht-a9", "installationId": "nowplaying"}
```

`installationId` is optional, defaults to `nowplaying`, and must differ from the status installation. The token file follows the existing private-file rules. The playback feed reads `<hubUrl>/api/playback/v1/snapshot` with a 2.5 s deadline, a 64 KiB body bound and no redirects, and validates the envelope strictly. Without `nowPlaying`, the runner creates no playback feed or publisher, and its connection has no additional installation.

Stopping cancels queued writes for both tiles and leaves both installations in rotation. A restart evaluates the current snapshot and removes a leftover now-playing tile when nothing is playing.

## Risks / Trade-offs

- A long silence in the hub, of 30 s or more, removes the tile, and the next good read pushes it again. Each push costs one cloud call, bounded by the 15 s gate.
- Title text now reaches a cloud service. It is the owner's music metadata, not agent content, and it is never logged. The runner prints no playback data.
- Two tiles double the worst-case push rate to two writes every 15 s. #16 observed no rate limit, and a 429 still holds the whole queue.

## Migration Plan

None for source. An installed runner keeps its current behavior until the owner adds `nowPlaying` and restarts it.
