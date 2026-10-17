## Why

The approved Pixoo design currently runs only as a local mockup. [#1154](https://github.com/jimmie-potts/agent-device-hub/issues/1154) brings its reusable card, animated media selection and playlist editing into the current runtime without duplicating the module's library or player.

## What Changes

- Export one module-owned display card and its reusable media picker and playlist editor through the existing frontend entry, for Home, device and Player consumers.
- Keep artwork mounted across Display/Content tabs and preserve advanced pages.
- Read bounded media pages and referenced frames through the shell context; animate visible previews with reduced-motion and cleanup support.
- Bind explicit media/playlist actions to existing guarded tracked commands. Create named populated playlists with a deterministic identity in one owner transaction, extending the existing create operation additively where necessary.
- Keep drafts, saved playlists and frozen active playback separate; repeat playlists and require explicit restart for saved changes.

## Capabilities

### New Capabilities

- `pixoo-reusable-controls`: Shared glass card, animated selection and playlist editing across runtime surfaces.

### Modified Capabilities

None. Existing module behavior remains compatible; new creation fields are optional.

## Impact

Pixoo browser components, its additive playlist-create request and library transaction, runtime Home/device composition, focused tests and existing CI discovery. Existing SDK, gateway, credentials, single device writer and private storage boundaries remain authoritative. No new dependency, transport, room schema or physical-device permission.
