## 1. Lock down the behavior

- [x] 1.1 Add `apps/runtime/dashboard/tests/home-packing.test.ts` for row packing, stacking, a lone short card and grid placements, and extend `paging.test.ts` for catalog heights and the art-only opt-out.
- [x] 1.2 Change `home-card-heights.browser.ts`: long equals two short heights plus the gap, cards in a track start and end together, Hub mode and Wispr stack beside the Inbox, a Pixoo and a light card stand beside two short cards, with an Inbox of 0, 1 and 13 items.

## 2. Implement

- [x] 2.1 Declare heights in the widget and Home catalogs, add `home-packing.ts`, render Home as one 24-column grid in saved order, and set page sizes for the long height; the unit and browser tests pass.

## 3. Records

- [x] 3.1 Update the dashboard and runtime guides, validate strictly, synchronize `home-layout` and archive on the delivery branch.
