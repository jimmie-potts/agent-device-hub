## Why

Home will show the presented artwork as its backdrop ([epic #1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927)). Today the art module exposes only the presented artwork's identity, palette and readiness, and its decoded image stays private to the widget. [#1928](https://github.com/jimmie-potts/agent-device-hub/issues/1928) lets the shell draw it, under owner decision 3 of the epic.

## What Changes

- The art frontend exports `ArtBackdropSource`, `useArtBackdrop` and `useShowArtBackdrop`. The source follows the same record and selection as the Art widget and decodes that composition's largest still from the existing authenticated content route.
- A newer image that is loading, stale or failed leaves the last ready image in place. An obsolete load never replaces a newer one.
- The presentation evidence combines the widget's and the backdrop's, so one surface going idle does not erase the other's.
- The shell mounts the source once on Home while the art module runs. It draws nothing yet; #1929 draws the backdrop.

## Capabilities

### Modified Capabilities

- `runtime-dashboard`: Module-owned art presentation gains the backdrop export; presented art metadata combines the widget's and the backdrop's evidence.

## Impact

`modules/art/src/frontend`, the runtime dashboard shell and the art browser journey. No new route, command, message format, stored field or Content Security Policy change. Delivery target: reviewed source; the glass layer (#1929) is the first consumer.
