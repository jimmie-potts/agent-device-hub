## Why

[Hub #495](https://github.com/jimmie-potts/agent-device-hub/issues/495) composes a disposable preview from three verification runs: Hub, Nanoleaf wall and Pixoo. The dashboard's Places navigation is compiled from `docs/skins/places.json`, so a preview's "Wall · Local" link still opens the installed wall at `127.0.0.1:8765`. That link leaves the preview and can lead the owner to real state. A preview must link to its paired run or show no Wall link.

## What Changes

- Add an optional private Hub configuration field, `placeLinks`. It maps a Local place id to a credential-free numeric-loopback URL and is validated before startup like `editorLinks`.
- When `placeLinks` is configured, the dashboard context carries it. The Places navigation then links each named Local place to its configured URL and omits every other Local destination except the current B.U.N.N.Y. place. The Public places are unchanged.
- The Hub's verification runs configure it. The `integrated` scenario points Wall at the paired wall run. The standalone scenarios configure it empty, so they show no Wall link.
- Without `placeLinks`, the installed Hub and every existing configuration behave exactly as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shared-places-navigation`: a Hub configured for a verification preview replaces or omits the dashboard's Local destinations instead of linking to the installed services.

## Impact

`apps/hub` (configuration validation, `cli.js` configuration keys and the dashboard context response) and `apps/dashboard` (Places rendering) change. The Hub verification adapter (`apps/hub/verify`) configures `placeLinks`, and the dashboard test fixture accepts it. The published guide, architecture viewers, atlas and reference pages do not change. The Nanoleaf and Pixoo repositories are untouched. No credential, runtime value or query string enters a Places link. The installed Hub needs no configuration change. The design artifact is omitted. The change adds one validated optional configuration field, one optional context field and conditional rendering in one view. It changes no state, concurrency, migration, timing or installation, and adds no dependency.
