## Why

The owner accepted the Clear Home prototype (epic [#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927), reference `docs/design-references/home-clear/`). Story [#1932](https://github.com/jimmie-potts/agent-device-hub/issues/1932) lets a light's arrow unfold its panel in place into the controls the two-row card has, while the glass spills like mercury as it grows and its neighbors make room. Owner decision 7: one panel open at a time, not saved in the layout, closed by its arrow or Escape.

## What Changes

- A light, room or group ring dial in the Small square Home shape gains an arrow at its top left. It opens the card in place to Large square, packed with the existing first-fit packing, with the dial, its lines, a link to the card's page, its options and the existing tabbed controls (power and brightness with the saved mode, color, scenes, timer). The cards that move ease from where they were over 720 ms with the reference's overshoot.
- One card is open at a time; its arrow or Escape closes it. Focus moves into the opened controls and back to the arrow. Opening and closing send nothing and are never saved; a reload, Edit Home, a narrow screen or the Phone arrangement show none open.
- The glass layer turns a moving or resizing panel liquid by how fast its box changes: rounder corners, a wobbling edge and a wider join, settling in about a second, on a time base. Scrolling, a window resize and reduced motion stir nothing; with reduced motion the cards move at once.
- A stale lighting layout's notice sits inside each light card on Home instead of on the backdrop above its face.

## Capabilities

### Modified Capabilities

- `runtime-dashboard`: unfolding a light on Home and the liquid glass.
- `runtime-lighting`: the ring dial's top left holds the arrow, and the stale layout notice sits inside a Home card.

## Impact

`apps/runtime/dashboard/src` (Home layout, a new unfold module, light card, dial styles, lighting workspace, glass layer, renderer, shader and a new liquid module) and the glass browser journey. No command, sync family, route, stored field or content request is added; the Home layout record and its packing are unchanged; the Content Security Policy is unchanged. Installation is tracked in [#1935](https://github.com/jimmie-potts/agent-device-hub/issues/1935).
