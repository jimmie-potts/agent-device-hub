## 1. Tests first

- [x] 1.1 Read `stand-in-history` and `inbox-item` in a real disposable run (`apps/runtime/verify/tests/supervisor.test.ts`). Evidence: red before the schema change, timing out on the action's outcome in the stand-in history.
- [x] 1.2 Show that a clean stop ends a held, unanswered action `uncertain` at once and a queued one failed with `cancelled`, that the restart sends neither and that the deadline adds nothing (`apps/runtime/tests/tracker.test.ts`). Evidence: it documents existing behavior and passes as written.
- [x] 1.3 Assert the route's 404 detail for an unknown family, and that a known family with no running module is tracked and answered 503 `unavailable` (`apps/runtime/tests/actions.test.ts`). Evidence: red on the old detail; the `unavailable` case passes as written.

## 2. Changes

- [x] 2.1 Register the stand-in history schema in the verify child.
- [x] 2.2 Change the route's 404 detail, and the wording in the spec, the runtime README and the comments.

## 3. Checks

- [x] 3.1 Run the gate: build, typecheck, lint:js, `test:runtime:built`, `test:runtime:scenarios:built`, `test:runtime:verify:built` alone, `test:workflow`, check:workflow and `openspec validate --specs --strict`; sync and archive this change.
