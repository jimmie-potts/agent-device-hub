## 1. Lock down the behavior

- [x] 1.1 Add `apps/runtime/dashboard/tests/home-card-heights.browser.ts`, chained from the Home editor journey: rows line up at Small, Standard and Wide with an Inbox of 0, 1 and 13 items; Inbox paging with the total count; an expanded item inside the card; dismissing the only item on a page; focus after paging and dismissal; Agent status and Timeline through the shared pager; saved layouts unchanged; narrow content height. With the old Home CSS it fails at the first row check (Inbox 188.5 px beside 698 px).
- [x] 1.2 Add `apps/runtime/dashboard/tests/paging.test.ts` for the page arithmetic and the catalog's tall-card opt-out.

## 2. Implement

- [x] 2.1 Add the standard height token, the stretched rows, the narrow-screen rule and the catalog `tall` flag; the browser journey's row checks pass.
- [x] 2.2 Add `PagedList` and `paging.ts`, and use them in the Inbox, Agent status and Timeline cards, replacing Timeline's Show more; the browser journey and the updated `timeline-card.browser.ts` pass.

## 3. Records

- [x] 3.1 Update the dashboard and runtime guides, validate this change strictly, synchronize `home-layout` and `timeline-card`, and archive the change on the delivery branch before final review.
