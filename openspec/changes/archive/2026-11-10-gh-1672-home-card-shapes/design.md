## Context

Home wrapped cards in saved order with flex widths (`small` 260px, `medium` 340px, `large` a full row) and each card
took its content height, from 296px (Hub mode) to 811px (Pixoo), so mixed rows left large empty areas. The owner chose
four shapes from one unit square (#1672, 2026-11-10) and, from the Stage A screenshots on draft PR #1673, a 220px unit
with a 16px gap (D1, 2026-11-11). List paging from #1658 (PR #1665) is the base.

Owner decisions: the four shapes; the owner picks each card's shape in Edit Home; compact content instead of
scrolling, stretching or clipping; the first compact set; art and the visualizer take shapes; narrow screens keep one
column; the 220px unit; Inbox offers no Small square; cards outside the first compact set get a generic compact face so
every card is one of the four shapes. Coordinator choices: the conversion is stored at the owner's next explicit save;
automatic art fills only trailing empty cells. The delivery is split: this change (PR A) is the model, the grid, the
picker, the conversion, the generic face and bespoke compact content for the dashboard-owned cards. PR B adds an SDK
presentation hint and bespoke compact markup inside the Pixoo, Tidbyt and Wispr module frontends; until then those
three show the generic face.

### Where the Home layout lives

| Layer | Place | What it holds or does |
| --- | --- | --- |
| Owner and store | `apps/runtime/src/core/home-layout.ts` (`HomeLayoutPart`), table `home_layout` in `modules/core.sqlite` | One row `id = 'home'` with a JSON record `{id, revision, version: 1, layouts: {desktop, phone} \| null}`. |
| Writes | same file | The owner's save through `home-layout-set` (operator admission, revision and expiry guards, art-option and shape preservation for older clients) and `reconcileLighting` for grouping and room Home actions. |
| Contract | `packages/event-contracts` `home-layout` 2.0, 2.1 and 2.2 schemas, `home-layout-set` 2.0, `src/v2/home-layout.ts` | `size` is required; 2.2 adds optional `shape`. |
| Transport | existing core sync and the gateway command route | No Home-specific route, MCP tool or module. |
| Dashboard | `home-layout.tsx`, `home-catalog.ts`, `home-shapes.ts`, `home-art.ts`, `widgets.ts` | Catalog, offered shapes, conversion, packing, picker, rendering. Never writes on load. |

The core owns the state; the dashboard owns the catalog and rendering. The change crosses the dashboard–core boundary
through the shared contract package, additively. Card UIs in module packages (Pixoo, Tidbyt, Art, Wispr, Roborock,
Volcano, companions) are not changed in PR A.

## Goals / Non-Goals

**Goals:** every wide-layout Home card is one of four shapes on one grid; the owner picks shapes; compact content per
shape; old layouts load unchanged in widgets and order; older dashboards keep working.

**Non-Goals:** bespoke compact content inside module frontends (PR B); shapes on other pages; a new Inbox page; changes
to device controls, their queues or command paths.

## Decisions

### 1. Store an optional `shape` beside the existing `size`

Entries gain optional `shape: 'square' | 'wide' | 'tall' | 'large-square'` (kebab-case, ADR 0012). `size` stays
required. The core publishes `home-layout/2.2` (2.1 plus `shape`); `home-layout-set/2.0` references the 2.2 layouts, the
additive optional-command-field convention #682 used for art. The record stays `version: 1`; the core store needs no
migration. A new dashboard writes both, with `size` from `homeShapeSize` in the contracts package: square and tall
store `small`, wide and large-square store `medium`.

### 2. Convert on load, store at the next explicit save

A placement without `shape` (or with one its card no longer offers) shows: Small → Small square, else Tall; Standard →
the card's Standard shape; Wide → Large square, else Wide; art → its format (banner Wide, tall Tall, square and auto
Large square). Loading writes nothing. Done, Reset-then-Done and the art Pin, Unpin, Dismiss and Restore actions store a
shape and agreeing width for every known placement in both arrangements.

The core keeps a shape only while it agrees with `size`; an incoming placement without `shape` that keeps its previous
`size` keeps the previous shape. `reconcileLighting` keeps the base entry's shape when members merge into a group and
places a newly selected light or room card as `{size: 'small', shape: 'tall'}`.

Acceptance examples, written as tests before the implementation:

1. Core: an old record publishes as 2.2 unchanged and is not rewritten on open (`home-layout.test.ts`).
2. Dashboard: the conversion table above (`home-catalog.test.ts`).
3. Dashboard: loading an old-format layout sends no command (`home-shapes.browser.ts`, convert).
4. Core: a shape with an agreeing width is stored and published.
5. Core: an older dashboard's width change drops the copied shape.
6. Core: a save without the shape keeps it while the width is unchanged and drops it with a new width.
7. Core: a duplicate delivery is not saved again and a stale revision is refused with nothing changed.
8. Contract: 2.2 accepts each shape and rejects others; 2.0 and 2.1 reject `shape` and keep accepting width-only data.
9. Core: grouping keeps the first member's shape; a new room card is Tall.
10. Older dashboards: they read `size` and ignore `shape` (covered by examples 5 and 6 at the core, and by the
    compatibility matrix in the PR walkthrough).

### 3. The unit grid and packing rule

`C = max(2, floor((W + 16) / (220 + 16)))` columns for grid width `W`; columns share the width and each row is one
column tall, so units are square and never smaller than 220px. Measured grid widths give 3 columns at a 1100px window
(273px cells), 5 at 1440px (226px) and 7 at 1920px (225px).

`packShapes` places cards in saved order, each at the first free position, row by row, where its shape fits. A later
card fills an earlier hole when it fits; this is the only case where a card appears before one saved ahead of it. DOM
and Tab order stay the saved order. A two-wide card that does not fit the rest of a row goes to the next position with
two free columns. No card is stretched. Edit Home marks remaining holes. Narrow screens (600px and below, or a grid
narrower than two units) and the Phone arrangement keep one column at content height with full content.

### 4. Offered shapes

Each shape a card offers fits at the 220px unit with no overflow, clipped control or scrolling inside the card; a
browser test measures every card in every offered shape at 1100, 1440 and 1920px.

| Card | Offers | Standard |
| --- | --- | --- |
| Hub mode, Timeline, Music visualizer, Art | all four | Wide, Tall, Wide, Large square |
| Light, room, group and Nanoleaf light cards | all four | Tall |
| Inbox | Wide, Tall, Large square | Wide (Tall before review round 2) |
| Agent sessions | Tall, Large square | Large square |
| Pixoo, Tidbyt, Wemo, Roborock, Volcano, sign, Music, Wispr, Reachy, MicroDuck | Small square (generic face) | Small square |
| Unavailable placeholders | Small square | Small square |

Pixoo, Tidbyt and Wispr full content is taller than 456px (a two-unit height), so in PR A they offer only the generic
face; PR B adds bespoke compact content in their modules and the larger shapes it fits.

### 5. Edit Home picker

The size select becomes a labelled group of shape buttons (icon, name, `aria-pressed`) in each card's edit bar, showing
only offered shapes, on the Desktop arrangement only. The edit bar overlays the top of the card so the editor shows the
real placement; holes are drawn as dashed empty cells. Changing a shape changes only the draft until Done.

### 6. Compact content

Cards read their shape from `HomeShapeContext`; off the grid it is undefined and cards render in full.

| Card | Small square | Wide | Tall | Large square | Rest lives |
| --- | --- | --- | --- | --- | --- |
| Hub mode | mode art and name, three icon choices, Check Inbox | mode beside labelled choices | full | full | exceptions: a link to Devices in one row |
| Inbox | — | one row a page | four rows a page | four rows a page | an opened item takes the page |
| Agent sessions | — | — | one-line summary, filter row, one tile a page | same, wider | — |
| Timeline | latest two entries, Open Timeline | same, wider | period and refresh, four a page | adds category filters | the Timeline page |
| Light, room, Nanoleaf | name, state, artwork, On/Off | adds brightness | tabs with every control face (artwork stays mounted, hidden) | artwork beside tabs | options menu and device pages |
| Art | image cropped, Unpin and Dismiss | cropped | cropped | cropped | Art Gallery |
| Visualizer | canvas, effect, Open full view | same | same | same | full view |
| Generic face | name, state, Open | — | — | — | the card's device, Music or module page |

The generic face's Open link leads to an existing page holding the card's full controls: `#/component/<id>` for device
cards (Pixoo, Tidbyt, Wemo, Roborock, Volcano, sign), `#/music/<id>` for Music, `#/module/wispr/analytics`,
`#/module/companions/reachy`, `#/module/companions/microduck`, `#/module/roborock/status`. A Volcano card
without a device and unavailable placeholders show their reason with no Open link.

### 7. Paged lists in a shape

Rows per page come from the shape (Inbox Wide 1, Tall 4, Large square 4; Timeline 2, 2, 4, 4; Agent sessions one row
of tiles). Inside a shaped card an opened row takes the page and the pager hides until it closes; the open rows are kept
in step in every mode, so opening, changing shape or width, closing and changing back never leaves a row stuck
(#1665 F11). Check Inbox still shows the item's page and opens it.

### 8. Art and the visualizer

Pinned art is a shaped card cropped (`object-fit: cover`) to its shape, with Unpin and Dismiss over its lower corner; Restore stays
below Home. Unpinned art takes the largest shape that fits the trailing empty cells after every occupied cell, never
adds a row, never moves functional cards and never saves; Pin keeps the shape it has. On the grid it depends only on the
columns and the cards' cells, so image arrival and the viewport's height never move it. The one-column layouts keep the
existing art reservation, its interaction freeze and the format choice, which also sets the art card's grid shape.

### 9. Review round 1 (PR #1673)

- The edit bar on the grid is one row with the card's name, its move handle and an Options button; Earlier, Later,
  the shape choice, Hide and Remove open in a panel below it, one card at a time, and Escape closes it.
- List cards measure how many rows their card holds (pager at the bottom, one-line "1 / 3" label); Hub mode spreads
  over its card; a Tall light shows its artwork in the room its face leaves. A browser test keeps the space below
  each card's last content under 48px or 15% of the card, whichever is larger.
- Automatic art with no trailing empty cell takes a Wide row of its own after the last card.
- Small square and Wide light cards show a command's result on one line under On and Off.
- The core also drops an art shape that disagrees with the art format (`homeArtShapes`), so an older dashboard's
  format change decides; ordinary cards keep the omitted-shape rule.
- A category chosen in Large square resets to All in shapes without the category buttons.

### 10. Review round 2 (PR #1673)

- Hub mode scales to its card: the mode's artwork grows with the space and the three choices stretch (icons in one
  unit, beside the mode in Wide, stacked in Tall, one row of tall buttons in Large square).
- The generic face's icon grows into the space its name, state and Open leave.
- List rows share the card's spare height with their content centred; PagedList measures them at natural height and
  settles on the smaller count if showing more or fewer rows would otherwise make it alternate.
- The test measures the largest blank band anywhere in a card (between consecutive content boxes, above the first and
  below the last): text lines, controls, images and panels holding them count; blank placeholders do not.
- A room or group with no lights says so in its artwork panel.
- Art keeps one element tree on the grid and in one column, so it stays mounted with its image and focus.
- Tall Agent sessions stacks its filters and shows each count over its label; tile columns and rows are measured in
  one pass after every render.
- The Inbox's Standard shape is Wide, and the built-in layout uses each card's Standard shape.
- In Edit Home the card's own heading is hidden under its edit bar.

### 11. Changed approach after round 3 (PR #1673, owner decision 2026-11-11)

Three review rounds left a list that re-measured and re-rendered every animation frame at some widths and a blank-space
rule that short lists could not meet, so the owner chose to calculate rather than measure:

- Rows per page come from the card's shape and the grid's known cell size. The layout passes each card's outer size
  (its cells plus the gaps between them) through the shape context, and Inbox, Timeline and Agent sessions compute
  `floor((card height - frame - chrome) / row)`, less the pager's reserve when the list needs a second page.
  `listFit` in `src/paging.ts` names every fixed size (frame, pager, each card's chrome per shape, row and tile
  heights, tile width and gap); `home-shapes.css` sets them on the elements, and the browser test checks each one
  against the rendered card. Agent sessions computes its tile columns from the card's width the same way.
- PagedList has no ResizeObserver, measured count, settle logic or `data-measuring`, and rows no longer stretch. The
  grid's one width observer is the only thing that observes size on Home; Agent sessions keeps its column observer off
  the grid only.
- Rows keep their height and sit at the top with the pager at the bottom. A full list leaves less than one row above
  the pager; a short list leaves the rest of the card plain; an empty Inbox or Timeline centres its message. The
  blank-band rule now covers every card except these lists.
- When the page size changes (a new shape or window width), the list keeps the same rows in view: the page holding
  the opened row, or else the first row the page showed.
- A room or group with no lights offers Small square and Wide, and shows a saved Tall or Large square as Wide; a save
  keeps the stored shape for when it has lights again.
- In Edit Home only the card's own heading (in the header that opens its root element) is hidden; the generic face
  starts below the bar so its icon is not covered.
- An idle test records every change inside the list cards for two seconds after Home settles, at every width from
  1100 to 2560px in 20px steps with 0, 1, 5, 6 and 13 Inbox items, on the built-in and two mixed layouts.

### 12. Review round 1 of the changed approach (PR #1673)

- An opened row takes the page and the list becomes the card's only scroll area (`overflow-y: auto`); the heading,
  counts, filters and pager never shrink. Every control in an opened session or Inbox item scrolls into view inside
  the card. This is CSS only; nothing measures.
- A closed session tile shows its name and where it runs on one line each with an ellipsis (the full name is the
  title attribute and shows when the tile opens), so the state row always fits the 124px tile. The fit test also
  checks that nothing a closed row shows leaves it, with a long session title and long Inbox and Timeline names.
- A change of page size shows the page holding the row the owner last chose (by paging, opening or Check Inbox), which
  a size change never rewrites, so a round trip through another width returns to the same page.
- The Timeline reserves its status line's 28px in every shape, so a refresh no longer changes the page size.

## Risks / Trade-offs

- Visual order can differ from Tab order when a later card fills an earlier hole; Edit Home shows the real placement.
- Rows per page depend on the fixed sizes in `listFit`; a style change that alters one fails the browser test until
  the constant and the style agree again.
- Pixoo, Tidbyt and Wispr lose their full content on Home until PR B; Open reaches it in one step.
- The art crop reuses the existing dashboard rules for the art module's classes, as the reservation did.

## Migration Plan

No store migration. New core with an older dashboard: the older dashboard renders by `size` and copies `shape` when it
saves; the core drops a copied shape whose width changed. Older core with a shaped record (rollback): the older core
reads, syncs and reconciles the record unchanged (it does not validate its own stored record), but its 2.1 command
schema refuses any save whose entries carry `shape`. Because every dashboard copies saved entries, every save then
fails with `invalid-request` and nothing changes. Recovery after a rollback: in Edit Home, Reset Desktop and Reset
Phone, then Done, which sends width-only defaults the older core accepts.

## Open Questions

None for PR A. PR B: the SDK presentation field and the module frontends' compact layouts.
