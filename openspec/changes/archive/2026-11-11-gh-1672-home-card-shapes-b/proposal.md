## Why

Stage A of [#1672](https://github.com/jimmie-potts/agent-device-hub/issues/1672) (PR #1673) put every Home card on the
220px unit grid. The Pixoo, Tidbyt and Wispr cards are drawn by their modules, which could not tell what shape they
were placed in, so they showed the generic compact face (name, state, Open) in a Small square only. The delivery split
of 2026-11-11 assigns their compact content to this second PR.

## What Changes

- The SDK's type-only frontend context (`@jimmie-potts/sdk/frontend`) gains an optional `presentation` field: the Home
  shape a module card is placed in and the card's outer size in CSS pixels, which the grid already knows. It is
  additive; a module that ignores it keeps its full card, and it is absent off the grid. No message format, command,
  subscription or polling path changes.
- The Pixoo, Tidbyt and Wispr modules draw compact content of their own for each of the four shapes, and Home offers
  them in every shape. Their Standard shape stays Small square, so the built-in layout and the conversion of
  Standard placements do not change.
- A Pixoo or Tidbyt card whose module does not serve its card, and an unavailable Wispr card, show the generic face in
  one unit and keep their stored shape for when the module is back.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: the compact content requirement names Pixoo, Tidbyt and Wispr among the cards with compact content of
  their own and states the module presentation hint.

## Impact

- `packages/sdk/src/frontend.ts` (type only), `apps/runtime/dashboard/src/module-page.tsx`, `home-catalog.ts`,
  `widgets.ts` and `home-shapes.css`.
- `modules/pixoo/src/frontend`, `modules/tidbyt/src/frontend` and `modules/wispr/src/frontend` (card markup and CSS
  only; Pixoo simulator startup, originals, renditions, playback recovery and Monitor/Media semantics are unchanged).
- Dashboard browser journeys: `home-shapes`, `pixoo-cards`, `tidbyt-card`, `wispr` and the hosted smoke entry.
- No core, contract schema, store or installation change.
