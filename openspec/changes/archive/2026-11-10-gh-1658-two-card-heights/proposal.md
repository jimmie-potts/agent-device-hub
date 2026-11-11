## Why

[Issue #1658](https://github.com/jimmie-potts/agent-device-hub/issues/1658), follow-on to `gh-1658-home-card-heights` on the same delivery branch. The owner reviewed screenshots of one 820 px standard height and revised decision D2 on 2026-11-10: Home needs two heights, a long list size and a short size half of it, so a long card stands beside two short cards or two square ones. Paging stays as delivered.

## What Changes

- Two standard heights replace the single one: short 448 px and long 912 px (two short heights plus the 16 px gap), defined once in `src/home-layout.css`.
- Each widget declares `height: 'short' | 'long'` in `src/widgets.ts`. Hub mode and Wispr are short; Inbox, Agent status, Timeline, MicroDuck, Reachy, Roborock, Volcano and the music visualizer are long. Device, light, room and Music cards are long; a card whose source is unavailable is short. Only art keeps the tall opt-out; the music visualizer now fits long.
- Home becomes one CSS grid of 24 columns. `src/home-packing.ts` packs saved cards into rows by their preferred widths, as wrapping did, shares each row's spare width, and stacks short cards beside long ones. Cards stay flat grid children in saved order, so document and keyboard order equal saved order.
- Rows per page follow the long height: Inbox 8, Timeline 6 on Home, Agent status two rows of tiles.
- Narrow screens are unchanged: one column, content height, lists page.

ADR 0012: no new message format, error shape, family, command or gateway route, and no polling path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: two standard heights, catalog-declared heights and two-height packing; list pages fit the long height.

## Impact

`apps/runtime/dashboard` only: the widget and Home catalogs, the Home grid and packing, page sizes, unit and browser tests, and the dashboard and runtime guides. Saved layouts and the stored record format are unchanged. Installation stays pending.
