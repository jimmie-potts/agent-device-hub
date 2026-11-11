## Why

Home cards set only a width (Small, Standard, Wide) and take their content height, so rows of mixed cards leave
large empty areas. On 2026-11-10 the owner rejected two attempts at standard heights (#1658, PR #1665) and chose a
modular grid instead: four card shapes built from one unit square that tile together (#1672).

## What Changes

- Home's wide layout becomes one unit grid. Each card is a Small square (1×1), Wide (2×1), Tall (1×2) or Large square
  (2×2), packed in saved order with equal gaps and no stretched or half-empty cards. Narrow screens and the Phone
  arrangement keep one column at content height.
- Each widget declares the shapes it offers. Edit Home replaces the Small / Standard / Wide choice with a shape picker.
- A card shows compact content for its shape: no in-card scrolling, no stretching and no clipped controls. The first
  compact set is Hub mode, Inbox, Agent sessions, Timeline, Wispr, light, room and Nanoleaf cards, Pixoo and Tidbyt.
  Other cards offer only the shapes their full content fits.
- Paged lists (#1658) take rows per page from their shape; an opened item takes the page.
- Art and the music visualizer take shapes; art is cropped to its shape.
- Saved placements gain an optional `shape`. The core publishes `home-layout/2.2`, which adds that field, and the
  existing `home-layout-set/2.0` command accepts it as an additive optional field. `size` stays required and valid, so
  older dashboards keep working. Saved layouts without shapes convert on load by a stated table and are stored with
  shapes at the owner's next explicit save.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: shapes, the unit grid, shape choice in Edit Home, compact content, shaped paging, shaped art, the
  additive `home-layout/2.2` record and the conversion of saved width-only layouts. As with the art options of #682,
  the contract change is specified here; `shared-event-contract` has no Home layout requirement to change.

## Impact

- Dashboard: `apps/runtime/dashboard/src` (home-layout, home-catalog, widgets, home-shapes, paging, light-card, the
  Hub mode, Inbox, Agent sessions, Timeline and visualizer cards, and their CSS) and its tests.
- Core: `apps/runtime/src/core/home-layout.ts` publishes 2.2 and keeps or drops a stored shape on save.
- Contracts: `packages/event-contracts` schemas, types, fixtures and tests for `home-layout/2.2`.
- SDK: an additive optional presentation hint on `FrontendContext` so module frontends (Pixoo, Tidbyt, Art, Wispr)
  can render compact content; their module packages render it.
- No new message family, error shape, polling path or device command (ADR 0012). No core store migration: the record
  stays version 1 JSON with an optional field.
