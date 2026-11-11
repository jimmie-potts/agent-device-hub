## Context

Home today wraps cards in saved order with flex widths (`small` 260px, `medium` 340px, `large` a full row) and each card
takes its content height. Content heights at 1440px on synthetic data range from 296px (Hub mode) to 811px (Pixoo), so
mixed rows leave large empty areas. The owner chose four shapes from one unit square (#1672, 2026-11-10). List paging
from #1658 (PR #1665) is the base: `PagedList` pages Inbox, Agent sessions and Timeline in the browser.

Decided by the owner: the four shapes; the owner picks each card's shape in Edit Home; compact content instead of
scrolling, stretching or clipping; the first compact set; art and the visualizer take shapes; narrow screens keep one
column. Open: D1, the unit size and columns at common widths, chosen from the Stage A screenshots.

### Where the Home layout lives today

| Layer | Place | What it holds or does |
| --- | --- | --- |
| Owner and store | `apps/runtime/src/core/home-layout.ts` (`HomeLayoutPart`), table `home_layout` in `modules/core.sqlite` | One row `id = 'home'` with a JSON record `{id, revision, version: 1, layouts: {desktop, phone} \| null}`. Entries are `{widget, size, hidden, art?}`. |
| Writes | same file | `#replace`: the owner's save through `home-layout-set` with operator admission, revision and expiry guards, art-option preservation for older clients. `reconcileLighting`: grouping and room Home actions rewrite placements in their own core transaction and append new light cards as `size: 'medium'`. |
| Contract | `packages/event-contracts`: `schemas/v2/families/home-layout.schema.json` (2.0), `home-layout.2.1.schema.json` (published), `home-layout-set.schema.json` (2.0, references the 2.1 `$defs/layouts`), `src/v2/home-layout.ts` (types, duplicate-widget check), fixtures and tests | `size` is `small \| medium \| large`, required; entries allow no other fields. |
| Transport | existing core sync of `home-layout` and the gateway's command route (`apps/runtime/src/gateway/gateway.ts` passes the trace) | No Home-specific route, MCP tool or module. |
| Dashboard | `home-layout.tsx` (read, edit, save), `home-catalog.ts` (catalog, defaults, add), `home-art.ts` (art placement, creates `size: 'medium'`), `widgets.ts` (declared sizes), `main.tsx` (`Widget size`) | Renders by `size`; never writes on load. |
| Tests | `apps/runtime/tests/home-layout.test.ts`, `tests/scenarios/home-layout.ts`, event-contract tests, dashboard unit and browser tests | |

The core owns the state; the dashboard owns the catalog, which shapes a card offers and how it renders. The change
crosses the dashboard–core boundary through the shared contract package. It is additive.

Card UIs that live in module packages and would render compact content themselves: Pixoo (`modules/pixoo/src/frontend`),
Tidbyt (`modules/tidbyt` frontend), Art, Wispr, Roborock, Volcano and the companions widgets. Their Home cards are
styled partly by the dashboard (`lighting.css` styles `.pixoo-card` and `.tidbyt-card`).

## Goals / Non-Goals

**Goals:** every wide-layout Home card is one of four shapes on one grid; the owner picks shapes; compact content per
shape for the first set; old layouts load unchanged in widgets and order; older dashboards keep working.

**Non-Goals:** compact content for cards outside the first set; shapes on other pages; a new Inbox page; changes to
device controls, their queues or command paths.

## Decisions

### 1. Store an optional `shape` beside the existing `size`

Entries gain optional `shape: 'square' | 'wide' | 'tall' | 'large-square'` (kebab-case, ADR 0012). `size` stays
required. The core publishes `home-layout/2.2` (2.1 plus `shape`); `home-layout-set/2.0` references the 2.2 layouts, the
same additive optional-command-field convention #682 used for art. The record stays `version: 1`; the core store needs
no migration.

A new dashboard writes both fields, with `size` set from the shape so an older dashboard shows a close width:

| shape | stored `size` |
| --- | --- |
| square, tall | small |
| wide, large-square | medium |

If the card does not declare that size, the older dashboard already falls back to the card's first declared size.

Alternatives: replacing `size` with `shape` breaks older dashboards and the published schema; a core migration that
rewrites stored records at startup would need the dashboard's catalog in the core and would write without an owner
action.

### 2. Convert on load, store at the next explicit save

A placement without `shape` shows `shapeForSize(size, offered, standard)`:

- `small`: Small square, else Tall, else the first offered.
- `medium`: the card's declared Standard shape.
- `large`: Large square, else Wide.

Standard shapes: Hub mode Wide; Inbox Tall; Agent sessions Large square; Timeline Tall; Wispr Wide; the visualizer Wide;
Reachy and MicroDuck Large square; Roborock and Volcano Tall; light, room, Nanoleaf, Pixoo, Tidbyt and other device and
Music cards Tall; unavailable placeholders Small square. Art takes its saved format: banner Wide, tall Tall, square and
auto Large square.

The conversion is a pure function of the stored record and the catalog, so every browser and reload shows the same
shapes. Nothing is written on load (the existing rule against silent layout writes stands). The owner's next Done, Reset
or art action writes `shape` for every entry in both arrangements. Restart reads the stored JSON unchanged. A repeated
save with the same request ID is answered from the existing operation record without a second write; a stale revision
is refused with `revision-conflict` as today.

The core keeps a stored `shape` only while it agrees with `size`. On save, for each incoming entry:

- with `shape` and `size` equal to that shape's stored size: keep it;
- with `shape` and a different `size` (an older dashboard changed the width and copied the old shape): drop `shape`, so
  the card converts from its new size;
- without `shape`, for a widget whose previous entry had a shape and the same `size` (a client that rebuilt the entry
  without the field): keep the previous shape, as the art options are kept today.

`reconcileLighting` keeps the base entry's shape when it merges devices into a group and adds new light cards without a
shape, so they convert to Tall.

Acceptance examples, written as tests before the conversion is implemented:

1. Core, older record: a stored 2.1 record `{widget: 'hub-mode', size: 'medium'}` loads, publishes as 2.2 unchanged and
   survives restart byte-equal.
2. Dashboard, conversion table: `hub-mode` medium shows Wide; `inbox` small shows Tall; `sessions` medium shows Large
   square; a light medium shows Tall; a light large shows Large square; a Roborock small shows Tall; art with format
   banner shows Wide. Widgets and order are unchanged.
3. Dashboard, no write on load: loading an old-format layout sends no `home-layout-set` command.
4. Core, new save: a save with `{widget: 'inbox', size: 'small', shape: 'tall'}` stores and publishes it; restart reads
   it back.
5. Core, older dashboard changes width: stored `{size: 'small', shape: 'tall'}`, incoming `{size: 'medium', shape:
   'tall'}` stores `{size: 'medium'}` without shape.
6. Core, older client omits shape: stored `{size: 'medium', shape: 'large-square'}`, incoming `{size: 'medium'}` keeps
   `shape: 'large-square'`; incoming `{size: 'large'}` stores no shape.
7. Core, duplicate save: the same request ID twice yields one revision and one state; a stale revision is refused and
   nothing changes.
8. Contract: 2.2 accepts each shape and rejects an unknown shape; 2.1 and 2.0 fixtures still validate; the set command
   accepts entries with and without `shape`.
9. Core, lighting reconcile: grouping two placed lights keeps the first light's shape on the group card.
10. Dashboard, older dashboard view: a 2.2 record whose entries carry `shape` renders by `size` in the current release's
    code path (checked by rendering the record with shapes ignored).

### 3. The unit grid and packing rule

Columns: `C = max(2, floor((W + g) / (U + g)))` for grid width `W`, minimum unit `U` (D1) and gap `g` (16px). Columns
share the width equally; each row is one column wide, so units are square. Measured grid widths: 852px at a 1100px
window, 1192px at 1440px, 1672px at 1920px.

Packing (`packShapes`): cards in saved order, each at the first free position, row by row, where its shape fits. A
later card fills an earlier hole when it fits; this is the only case where a card appears before one saved ahead of it.
DOM order and Tab order stay the saved order. A two-wide card that does not fit the rest of a row goes to the next row
with two free adjacent columns; the cell it skipped is filled by a later one-wide card or stays empty. With an odd column
count, two-wide cards can leave one column; Edit Home shows remaining holes and which shapes fit them. Holes are never
filled by stretching a card. The trailing cells of the last row stay empty unless automatic art takes them.

Narrow screens (the existing 600px breakpoint, or a grid narrower than two units) and the Phone arrangement keep one
column at content height and full content.

### 4. Catalog declaration

`WidgetDefinition` gains `shapes` and `standard`. Light, room, Nanoleaf, Pixoo and Tidbyt cards offer all four. Inbox
offers Wide, Tall and Large square (open question Q2). Cards outside the first set offer the shapes their full content
fits at the chosen unit; with any candidate unit that is only Tall and Large square, and for some only Large square or
none (Q3). The final per-card list is fixed after D1 and checked by a test that measures each card in each offered shape.

### 5. Edit Home picker

The size select becomes a labelled group of shape buttons (icon and name, `aria-pressed`), showing only offered shapes,
in the card's edit bar. The edit bar overlays the top of the card so the edit preview keeps the real tiling. Changing a
shape changes only the draft; Done saves. Desktop and Phone keep separate choices; the Phone arrangement keeps no shape
picker because it has one column.

### 6. Compact content per shape

Cards read their shape from a dashboard context (`HomeShapeContext`); off the grid it is undefined and cards render in
full. Module frontends receive it through an additive optional `presentation: {shape}` on `FrontendContext`.

| Card | Small square | Wide | Tall | Large square | Rest lives |
| --- | --- | --- | --- | --- | --- |
| Hub mode | mode art and name, three icon choices | mode beside labelled choices | full | full | exceptions: Check Inbox and mode exceptions on Devices |
| Inbox | not offered | one row a page | rows a page from the unit | same as Tall, wider rows | an opened item takes the page |
| Agent sessions | counts (working, need you, unread) and the first waiting session | one row of tiles | two rows of tiles, filters folded | two rows, filters shown | Habitat and session page |
| Timeline | latest two entries, Open Timeline | latest entries one line each | paged entries, filters folded | paged with filters | the Timeline page |
| Wispr | today's words | today and speaking minutes | full | — | Wispr analytics page |
| Light, room, Nanoleaf | name, state, artwork, On/Off | adds brightness | tabs with a smaller artwork | artwork beside tabs | options menu, brand and room pages |
| Pixoo, Tidbyt | name, state, display preview, caption | preview beside caption | preview, caption, tabs | preview beside tabs | options menu and module pages |
| Art | image cropped to the square | cropped banner | cropped tall | cropped square | Art Gallery |
| Visualizer | canvas, effect name | canvas | canvas | canvas | Audio visualizer page |

No shape scrolls inside the card. Device controls stay reachable from Home or one step away on the card's page.

### 7. Paged lists in a shape

Rows per page come from the shape at the minimum unit, so a page and its pager fit at every width. The values are set
after D1 (prototype at 220px: Inbox Wide 1, Tall 4, Large square 4). Inside a shaped card an opened row takes the page
and the pager hides until it closes; this reuses the `expandAlone` behavior from PR #1665's history (`17e8dd63`). Check
Inbox still shows the item's page and opens it.

### 8. Art and the visualizer

Pinned art is an ordinary shaped card, cropped (`object-fit: cover`) to its shape; its Pin, Dismiss and Restore controls
stay. Unpinned (automatic) art takes the largest offered shape that fits the trailing empty cells, or is omitted; it
never moves functional cards and never saves. Art reacts only while visible, as now. The visualizer fills its shape
with its existing canvas; only its card layout and CSS change.

## Risks / Trade-offs

- Visual order can differ from Tab order when a later card fills an earlier hole. Mitigation: Edit Home shows the real
  placement while reordering.
- Cards without compact content may fit no shape at a small unit (Q3).
- Fixed rows per page depend on D1; a later unit change must update them and the measuring test.
- Stage A prototype uses dashboard CSS against module class names for Pixoo and Tidbyt; Stage B moves compact markup
  into the module frontends.

## Migration Plan

Contract 2.2 and the core keep/drop rule ship with the dashboard in one release. Old records need nothing. Rollback to
an older release reads shape-bearing records through 2.2-unaware code that ignores `shape` only if the older core's
validator accepts the state; the older core validates commands, not its own stored record, and an older dashboard
ignores the field. A rollback save from an older dashboard sends entries with `shape`, which the older core's 2.1
command schema rejects; after rollback the owner resets the layout or the rollback build includes the 2.2 schema.

## Open Questions

- D1: unit size and columns (screenshots in the Stage A hand-back).
- Q2: Inbox has no page of its own, so it offers no Small square.
- Q3: cards whose full content fits no shape at the chosen unit.
- Q4: conversion stored at the next explicit save, not automatically.
