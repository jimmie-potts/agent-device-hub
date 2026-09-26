# Shared device art

The hub-owned rendering components that the B.U.N.N.Y. shell draws devices with
([ADR 0007](../../../../docs/decisions/0007-bunny-shell.md), delivered for the
Nanoleaf Lines and Panels by [Hub #355](https://github.com/jimmie-potts/agent-device-hub/issues/355)).
A component here draws from geometry and a snapshot the page has already read.
It issues no request, opens no device state, keeps its own animation clock and
selection state, and derives every animation from its inputs, never from device
frames.

## Files

| File | Role |
| --- | --- |
| `prism.ts` | The Prism finish kit: crystal tubes, hexagonal connectors, the opening assembly, the two-second Work flow and the selection, pending and focus rings. `validate` is pure; `Renderer` touches only its host element. |
| `panels.ts` | The NL22 Light Panels as triangles in the same material, with the same setter API. The wall map has no Panels art, so this is new drawing in the Prism language, not a port. |
| `nanoleaf.ts` | Pure adapter from the hub's geometry route and `nanoleaf.integration/1.0` snapshot to layouts, presentation and the schematic strip. |
| `NanoleafArt.tsx` | The React host: mounts the right renderer, applies presentation on every snapshot, draws the strip when the physical layout is unavailable and marks a stale snapshot. |

## Provenance

`prism.ts` is a TypeScript port of `bridge/prism.js` from
[codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf) at
`97b6b37fcbf93061adda9afab253517cee24996e` (the file last changed in
`2944a3a0a7ce58da0a36125859d7d3f277bece76`, SHA-256
`b4335c940c608216e5e44888e7076136e2dcc96b3be965fe22efd038b1315d45`). The
material factories, timing, roots, input handling and lifecycle are unchanged;
the port adds types, exports instead of a `window.Prism` global, and reads
`matchMedia`, `IntersectionObserver` and `MutationObserver` from the page
without assuming them. The owner-provided Prism finish kit (archive SHA-256
`ceef5c07993fa3aba77daae02521747fbb55d1c8595002231a378d06105f8fb0`) is the art
source; Nanoleaf keeps its reference exports under `bridge/assets/prism/` until
the wall map retires. The look follows
[Nanoleaf ADR 0004](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0004-wall-map-visual-direction.md)
and the [application UI style guide](../../../../docs/application-ui-style-guide.md).

`nanoleaf.ts` replaces the wall map's `bridge/prism-adapters.js` (SHA-256
`3b7ae4523c1f5e0b9b555aa2f42d2327b0f0acdd31864de454c2eac505a7cbb9`), which read
the bridge's private state; the hub adapter reads the geometry route's connector
graph and the integration snapshot instead. The wall map's measured number
placement (`bridge/prism-labels.js`) is not ported: numerals show on hover,
focus and selection at the renderer's default offset.

## Inputs and what the hub can see

- Geometry: `GET /api/controllers/v1/<alias>/integration/geometry`
  (codex-nanoleaf#169). The Lines need the connector graph and every element's
  points; the Panels need three corners per element. A device without a saved
  layout, an owner that predates the route (422) or an incompatible owner (502)
  is final for the session; other failures are retried on the next poll. The
  page reads the geometry once after a device's first poll, so the 5-second poll
  and the one-slot device client are unchanged. Reload the page after a layout
  change in the wall editor.
- Snapshot: `mode`, `settings.style`, `projects[].color`, `elements[].projectId`
  and `.signature`, and `wallPending.elements` for pending marks. Colors follow
  the wall map's rule: the status color on both zones, and in the project
  layout style the signature zone takes the reservation's project color.
- Status and activity: inputs. The hub snapshot carries neither which Line shows
  which task nor that task's status, so the component pages pass none and the
  caption says so; the browser harness (`apps/dashboard/tests/art.mjs`) drives
  them. A stale or unavailable snapshot keeps the last art with a stale mark.
- Status colors are the fixed-meaning `--wall-*` tokens of the application skin
  (style guide section 4.2), read once per mount; the crystal material's own
  gradient colors stay in the renderer source, as in `prism.js`.

Reduced motion skips the opening assembly and stops the flow while Work, Quiet
and Free stay distinguishable by glow. Labels use element numbers and the
controller's neutral identifiers.
