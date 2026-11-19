## Why

The owner accepted the Clear Home prototype (epic [#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927), reference `docs/design-references/home-clear/`). In it the hub mode is a hero above the panels: a large word, a three-way switch whose glass thumb stretches as it travels, and short status chips. Owner decision 5 made the hero fixed, not placeable, with the Art card's Unpin, Dismiss, Open Gallery and forecast notice as chips; the Hub mode and Art cards are no longer drawn in Home's grid. Story [#1930](https://github.com/jimmie-potts/agent-device-hub/issues/1930) delivers it.

## What Changes

- Home shows a hero above its cards: the "Hub mode" label, the mode word and a Work, Free and Quiet switch over the existing guarded hub mode command, with its stale, pending, refused, uncertain, read-only, Check Inbox and exception states.
- The glass layer draws the switch's thumb as two glass capsules joined with a smooth minimum, on a time base; it stops drawing once the thumb settles. Without WebGL 2 the selected segment has a plain fill.
- Chips: lights on and plugs on from observed records (stale and unknown stay unknown), the art's forecast notice through a new art frontend export, Open Gallery, Pin or Unpin, Dismiss and Restore.
- The Hub mode and Art cards leave the grid, the picker and the built-in layout; saved placements stay valid and keep their values through saves. Dismissed art leaves the Quiet glass wash behind Home.
- The grid's art card code (automatic art, shaped art, art format) is removed.

## Capabilities

### Modified Capabilities

- `runtime-dashboard`: the Hub mode hero, the forecast chip export and the Home composition.
- `home-layout`: the Hub mode and Art placements belong to the hero; the art placement controls become hero chips; bounded art placement is removed.

## Impact

`apps/runtime/dashboard/src` (the hero, the glass layer's thumb, Home's layout and catalog, the Quiet glass skin tokens) and `modules/art/src/frontend` (the forecast chip export). A new browser journey chained after the glass journey; the hub mode, art, Home layout, shapes, paging and glass journeys are updated. No command, sync family, route, stored field or content request is added; the Content Security Policy is unchanged. Installation is tracked in [#1935](https://github.com/jimmie-potts/agent-device-hub/issues/1935).
