## Why

The owner accepted the Clear Home prototype (epic [#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927), reference `docs/design-references/home-clear/`). Story [#1929](https://github.com/jimmie-potts/agent-device-hub/issues/1929) draws Home's cards on flat, transparent liquid glass over the unblurred artwork, with the existing Quiet glass panels where WebGL 2 is missing.

## What Changes

- A reusable WebGL 2 glass layer that a page mounts under its root: it draws a backdrop (the presented artwork, or the Quiet glass wash) and flat glass for every marked panel, with a thin bevel, soft shadow, rim and an automatic veil that keeps text readable.
- Home mounts the layer with its panels joined by a smooth minimum; the rail and phone bar are frosted over the backdrop.
- Without WebGL 2, or after a lost context, Home keeps its Quiet glass panels and every control.
- The glass colors are skin tokens; the Quiet glass wash colors become tokens the shell and the layer share.
- Until the art backdrop export of [#1928](https://github.com/jimmie-potts/agent-device-hub/issues/1928) merges, a temporary adapter supplies no artwork outside a disposable journey.

## Capabilities

### Modified Capabilities

- `runtime-dashboard`: Home draws its cards on a glass layer over the artwork.

## Impact

`apps/runtime/dashboard/src` (the layer, Home, the shell's footer, rail and phone bar marks, the Quiet glass and art theme skins) and a new browser journey chained from the Home layout journey. No command, sync family, route, stored field or content request is added; the Content Security Policy is unchanged. Installation is tracked in [#1935](https://github.com/jimmie-potts/agent-device-hub/issues/1935).
