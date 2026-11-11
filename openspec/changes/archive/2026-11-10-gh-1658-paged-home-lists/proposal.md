## Why

[Issue #1658](https://github.com/jimmie-potts/agent-device-hub/issues/1658): an Inbox of 13 items stood far taller than the cards beside it. Owner decision, 2026-11-10: lists page first (D1). Standard card heights were tried and withdrawn; card shapes are owned by #1672.

## What Changes

- Inbox, Agent status and Timeline page their lists through one shared pager: Previous, Next and "Page x of y". Rows per page are fixed: Inbox 5, Timeline 5 on Home and 20 on `#/timeline`, and Agent status two rows of tiles at the current column count.
- Paging runs in the browser over records the dashboard already holds; it adds no request and no polling path.
- The Inbox heading keeps the total on every page. Check Inbox shows its item's page. Dismissing the only item on the last page shows the previous page. Entries open in place.
- Agent status lists sessions that need the owner first and says so on the pager when they fill more than a page.
- Timeline replaces Show more with the pager and returns to page 1 on a new category or period.
- Focus stays in the list when its row goes away, and is never pulled back once it has left.

Home keeps its current widths and content height. ADR 0012: no new message format, error shape, family, command or gateway route, and no polling path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: paged list cards.
- `timeline-card`: paging replaces Show more; a new category or period starts at page 1.

## Impact

`apps/runtime/dashboard` only: the shared pager and page arithmetic, the Inbox, Agent status and Timeline cards, unit and browser tests, and the dashboard and runtime guides. Saved layouts and the stored format are unchanged. Installation stays pending.
