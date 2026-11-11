## 1. Tests

- [x] 1.1 Add `apps/runtime/dashboard/tests/home-paging.browser.ts`, chained from the Home editor journey: 13 Inbox items show five and "Page 1 of 3" and the card grows only by its pager, keyboard paging, an item opened in place on a later page with its controls reachable, last-item dismissal, Check Inbox landing page, background removal, attention-first sessions, Timeline reset, saved layout and 375 px.
- [x] 1.2 Add `paging.test.ts` for the page arithmetic, and change `timeline-card.browser.ts` for the pager, reset and in-place entries.

## 2. Implement

- [x] 2.1 Add `PagedList` and `paging.ts` and use them in Inbox, Agent status and Timeline; the unit and browser tests pass.

## 3. Records

- [x] 3.1 Update the dashboard and runtime guides, validate strictly, synchronize `home-layout` and `timeline-card`, and archive on the delivery branch.
