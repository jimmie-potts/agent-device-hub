## Context

Inbox rendered every open item, Agent status every session tile, and Timeline 20 entries at a time with Show more. Home cards take their content height, so a long list made its card tower over its neighbours.

## Goals / Non-Goals

**Goals:** one shared pager for the three list cards, fixed page sizes, truthful counts, focus that never falls to the page body.

**Non-Goals:** card heights or shapes (#1672); changing which Inbox items exist (#1657); accessibility criteria (owner decision 2026-11-10).

## Decisions

- **Component.** `PagedList` owns the page index, the pager and focus repair; `paging.ts` holds the arithmetic and page sizes. Every row stays mounted and off-page rows are hidden, so open evidence and unsent label drafts survive a page change.
- **Page sizes.** Inbox 5 and Timeline 5 on Home keep a full page close to the height of the cards beside them in the default layout; Timeline shows 20 on its own page; Agent status shows two rows of tiles at the grid's current column count, read with a `ResizeObserver`.
- **Check Inbox.** A `reveal` with a serial moves to the page holding the item during render, so the existing effect finds it visible, opens and focuses it.
- **Attention first.** Agent status orders sessions that need the owner first, stably, and adds "K need you, on the first M pages" to the page label when they exceed a page.
- **Focus.** The pager moves focus to the other button when one becomes disabled. The list remembers focus inside it; when that element is removed or hidden and focus would fall to the body, focus moves to the first visible control in the list without scrolling. Focus moving to an element outside the list is forgotten; focus dropping to nothing is kept only when its control was removed, hidden or disabled.
- **Timeline reset.** `resetKey` (category and period) returns to page 1.

## Risks / Trade-offs

- Fixed page sizes leave some cards shorter than their neighbours; shapes in #1672 address card sizes.

## Migration Plan

None. Browser-only; saved layouts are read unchanged.
