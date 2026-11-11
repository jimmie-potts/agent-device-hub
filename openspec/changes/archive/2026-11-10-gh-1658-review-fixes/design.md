## Context

Review of PR #1665 at `78d4c557` returned action required. The packing, heights, paging basics, saved layouts and editor passed.

## Goals / Non-Goals

**Goals:** resolve review findings F1 to F7 and F9 within the dashboard.

**Non-Goals:** moving art higher on Home (F8 is an owner decision); Volcano's and the light cards' existing in-card scrolling; any core change.

## Decisions

- **Lone cards (F1).** `gridPlacements` marks a row free when it is not Wide and has one column. Its tracks size to content and its cards drop the content minimum (`home-free`). A Wide card fills its row by choice and keeps the standard height.
- **Focus (F2).** The pager forgets its last focused element when focus moves to an element outside the list. When focus drops to nothing, it keeps the claim only if that control was removed, hidden or disabled (Dismiss disables itself while it waits). Otherwise, as after a click elsewhere, it forgets.
- **Attention first (F3).** Agent status orders sessions that need the owner first, stably. When more need the owner than one page holds, the page label adds "N need you, on the first M pages".
- **Timeline reset (F4).** `PagedList` takes `resetKey`; Timeline passes its category and period.
- **Headroom (F5).** Short is 464 px, long 944 px, leaving 18 px over Wispr's 446 px. Rows per page are unchanged, because they still fit.
- **Equal widths (F6).** `rowSpans` tries every split that gives each size one span and fills 24 columns, with Standard at least Small. It penalises any column under its preferred width and picks the split closest to the flex widths. With no equal split, for example five Standard columns, spans differ by at most one column.
- **Expansion (F7).** A `StandardHeight` context is true only inside a Home card held to a standard height. `PagedList` lets an opened row take the page only there.

## Risks / Trade-offs

- A lone card in the last row at the wide layout now takes its content height too, so that row can be shorter than the others.
- The Edit Home edit bars still add height: a stack of two short cards carries two bars, so the row grows while editing.

## Migration Plan

None. Browser-only, with saved layouts read unchanged.
