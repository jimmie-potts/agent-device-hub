## Why

[Hub #353](https://github.com/jimmie-potts/agent-device-hub/issues/353) lets the owner inspect Pixoo renditions and playlists without opening another application. [Pixoo #96](https://github.com/jimmie-potts/divoom-app-upgrade/issues/96) supplies the authenticated `pixoo-integration/1.1` catalog and lossless PNG-frame previews.

## What Changes

- Forward typed catalog, playlist and immutable preview reads through the Hub's existing controller authentication and request slot.
- Negotiate the 1.1 snapshot while preserving 1.0 snapshots and commands.
- Add media-grid, playlist-filmstrip and now-showing widgets to the existing catalog, with exact prepared pixels, timing and separate device compatibility.
- Refresh catalog reads when polled integration revisions change and coalesce refresh on feed resynchronization.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: authenticated bounded Pixoo catalog and representation forwarding.
- `unified-dashboard`: reusable read-only media widgets and revision-aware lossless previews.

## Impact

Changes are confined to Hub and dashboard source, their tests, documentation and OpenSpec. Pixoo retains originals, render caches, playback and device ownership. No installation or device commands are introduced. Owner layout editing remains separate.
