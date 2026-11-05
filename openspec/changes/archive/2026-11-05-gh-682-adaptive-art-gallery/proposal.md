## Why

[Issue #682](https://github.com/jimmie-potts/agent-device-hub/issues/682) gives the owner a browser experience for the private art catalog: view a rich composition, request new art, save favorites and give explicit feedback. The art owner already supplies bounded state, authenticated content and tracked commands; Home needs safe art placement without moving functional controls when an image arrives.

## What Changes

- Add a shipped art frontend with a rich still widget and a paginated gallery, using the shell's existing connection and authentication.
- Add bounded banner, square and tall art geometry, explicit layout pin/dismiss/restore controls and safe automatic use of trailing free space. Keep saved layouts in the core home-layout owner.
- Show per-provider allowance, generation progress, partial results, refusals and uncertainty. Explicit requests default to UI, Tidbyt and Pixoo compositions; browsing existing art makes no generation or device command.
- Decode a complete private rendition before presenting it, preserve stale/unavailable distinctions and expose the identity and palette of visibly presented art for the theme consumer.
- Extend synthetic browser and disposable scenarios, including keyboard, pointer, narrow-screen, restart and no-replay evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: bounded art-specific placement metadata, explicit pin/dismiss/restore and transient placement that preserves functional cards.
- `bunny-art`: authenticated gallery and request controls, truthful job/spending feedback and decoded browser presentation.
- `runtime-dashboard`: module-owned art frontend integration, accessible responsive presentation and a presentation seam for the theme consumer.

## Impact

Changes affect `modules/art` browser code, the runtime dashboard and its tests, core-owned home-layout metadata, shared event-contract definitions, build/CI discovery and the owning development guides. The existing `art/2.0`, `art-request/2.0` and `art-catalog-edit/2.0` interfaces remain the catalog and generation boundaries. No external repository contract, physical writer, provider adapter, installation or new service is introduced. Installed and physical acceptance remain with [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
