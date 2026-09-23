## 1. Controller removal

- [x] 1.1 Write failing connection tests for the removal `DELETE` request shape, success, 401, 429 and server errors against a fake fetch. Then add `remove()` and the `installationRemove` capability.
- [x] 1.2 Write failing controller tests for queued removal order, holds, schema-valid receipts with operation `remove` and malformed removal rejection. Then add `tidbyt.remove` and raise the profile to 1.1.0.

## 2. Status view and frame

- [x] 2.1 Write failing view tests for multiple sessions, child and idle exclusion, overflow, acknowledgment versus read evidence, unknown activity, neutral IDs, stale sessions and an unavailable feed. Then implement the view.
- [x] 2.2 Write failing frame tests for row colors, dimming, `?` markers, `+N MORE`, `FEED ?` and a valid 6144-byte frame accepted by the renderer. Then implement the font and frame drawer.

## 3. Publisher

- [x] 3.1 Write failing publisher tests with a fake feed, fake clock and fake connection for coalescing, the 15 s minimum, the 10 minute refresh, idle removal once, a listing check before removal, backoff after repeated failures, a hung feed read, stale feed without removal, failed push without replay and uncertain outcomes. Include one test that feeds a real agent-state owner. Then implement the publisher.

## 4. Documentation and delivery

- [x] 4.1 Record the layout, cadence and rotation decisions and the profile change in `controllers/tidbyt/README.md` and update `docs/development.md`. Verify by inspection.
- [x] 4.2 Run build, typecheck, contracts, Tidbyt, agent-state and workflow checks. Then synchronize the spec deltas and archive this change.
