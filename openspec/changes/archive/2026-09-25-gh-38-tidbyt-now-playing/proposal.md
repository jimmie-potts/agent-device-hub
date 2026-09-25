## Why

[Hub #38](https://github.com/jimmie-potts/agent-device-hub/issues/38) asks the Pixoo and the Tidbyt to show what is playing, read from the shared playback snapshot that [#175](https://github.com/jimmie-potts/agent-device-hub/issues/175) delivered. Each display's own controller renders and writes the card. This change covers the Tidbyt half. The Pixoo card belongs to the Pixoo application in [divoom-app-upgrade](https://github.com/jimmie-potts/divoom-app-upgrade) and is delivered there separately.

The owner settled the Tidbyt policy on 2026-09-25, before implementation:

- Placement: a second background installation that rotates beside the agent status tile. Alerts never interrupt it, so nothing needs restoring. Foreground takeover stays unqualified.
- Cadence: read the snapshot every 5 s. Push only when the card changes, at most once every 15 s, coalescing to the latest. Push an unchanged card again after 10 minutes.
- Stale: `playing` or `paused` shows the card, with a pause marker when paused. A `stale` snapshot keeps the card dimmed and marked `?`. `unavailable`, `stopped`, `inactive` or `unknown` removes the tile.

## What Changes

- Add a pure now-playing view and a 64×32 card drawer in `controllers/tidbyt`. The card shows a play or pause marker, the title on up to two lines and the artist on the rows after it. Long text wraps at word boundaries and is truncated with a trailing `.`. Accented letters fold to their base letter, and the 3×5 font gains the punctuation that track names commonly use.
- Add a now-playing publisher. It reads the snapshot every 5 s through a bounded reader, keeps the last good read, and pushes or removes its installation through the existing controller queue.
- Extract the status publisher's evaluation loop, bounded read, write cadence, backoff and installation-presence logic into shared publishing helpers, and its drawing helpers into a shared module. Both publishers use them. The status tile's behavior is unchanged.
- Let the cloud connection write to a small set of additional operator-configured installations. Display and removal commands may name one, raising the controller-local profile to `tidbyt-display` 1.2.0. Every write for the device still goes through the one queue, with shared holds.
- Extend the Linux runner with an optional `nowPlaying` block: a private read-token file, the playback source ID and the installation ID (default `nowplaying`). Without it, the runner behaves as before.
- Document the decisions and runner configuration in `controllers/tidbyt/README.md` and `docs/development.md`.

## Capabilities

### New Capabilities

- `tidbyt-now-playing`: the now-playing view, card drawing and publishing from the shared playback snapshot through the Tidbyt controller queue.

### Modified Capabilities

- `tidbyt-cloud-controller`: display and removal writes may target an additional configured installation through the same queue, under profile 1.2.0.
- `tidbyt-status-installation`: the runner accepts an optional now-playing configuration and reads the hub's playback snapshot with the same private-file, loopback and bounded-read rules.

## Impact

Changes stay under `controllers/tidbyt` (`src`, `tests`, `fixtures`, README), plus `docs/development.md` and a sentence in `docs/architecture.md`. The hub, its playback module and credentials, the shared controller v1 contract and the agent-state package are unchanged. Existing Tidbyt CI steps run the new tests through their glob. No device, account, service or installation is touched. Installing the updated runner and checking the display need the owner's separate go-ahead. Artwork stays with [#229](https://github.com/jimmie-potts/agent-device-hub/issues/229).
