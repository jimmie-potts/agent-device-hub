## Why

[Hub #355](https://github.com/jimmie-potts/agent-device-hub/issues/355) is the first device art under [ADR 0007](../../../docs/decisions/0007-bunny-shell.md): the B.U.N.N.Y. shell draws the Nanoleaf wall with the same Prism crystal material the wall map uses, from a hub-owned shared component that the home miniature ([#286](https://github.com/jimmie-potts/agent-device-hub/issues/286)), the Lines and Panels device pages and the later group page ([#271](https://github.com/jimmie-potts/agent-device-hub/issues/271)) reuse. The geometry it needs is delivered: Nanoleaf serves each device's saved element geometry read-only ([codex-nanoleaf#169](https://github.com/jimmie-potts/codex-nanoleaf/issues/169), `0043456`) and the hub passes it through `GET /api/controllers/v1/<alias>/integration/geometry` (#396).

## What Changes

- Port the Prism renderer (`bridge/prism.js`, its wall-state adapter and the reference-export notes from codex-nanoleaf `97b6b37`) into `apps/dashboard/src/art/`, with provenance recorded there. The renderer keeps its own animation clock and selection state, issues no requests and opens no device state.
- Add a hub geometry and snapshot adapter: the hub geometry route's connector graph and elements become the renderer's layout; the `nanoleaf.integration/1.0` snapshot supplies mode, project colors, element reservations and pending edits. The component also accepts per-element task status and activity as inputs; the hub snapshot has no source for them yet, so the live page draws them dark (see the issue's work assessment).
- Draw the NL22 Panels as triangles in the same material from the geometry route's polygons.
- Show the shared art on the Nanoleaf component pages above the device facts, with a schematic strip when a device has no saved layout or the owner predates the route, and a stale marking when the snapshot is stale or unavailable.
- Move the wall status tokens (`--wall-*`, `--chip-*`) into the application token layer, as the style guide's revised rules say.
- Read the geometry once per component after its first snapshot, and again only after a failed read, so the 5-second poll is unchanged.

Unchanged: controller v1 routing, the integration snapshot and its commands, the hub routes, MCP tools and the wall map.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: adds the shared Nanoleaf device art on the component pages.

## Impact

`apps/dashboard/src/art/*`, `apps/dashboard/src/main.tsx`, `apps/dashboard/src/style.css`, `apps/dashboard/src/skins/neon-geometry-wars.css`, `apps/dashboard/tests/{fixture,art}.mjs`, `apps/dashboard/tests/art.test.mjs`, `apps/dashboard/README.md`, `docs/development.md`, `docs/application-ui-style-guide.md` (token ownership note). Source only; a UI change that needs the owner's approval of the current candidate before merge. No installation, hub route or device change.
