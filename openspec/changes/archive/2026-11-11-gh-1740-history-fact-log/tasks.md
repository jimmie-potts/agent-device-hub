## 1. Fact log in the core store

- [x] 1.1 Write `apps/runtime/tests/history-fact-log.test.ts`: migration of a store created with the previous release's schema (every row's origin and sequence, every other column and table unchanged, a second open changes nothing), rows an older release adds, the origin's form and persistence across a restart, read after N (order, bound, cursor, unknown origin, invalid arguments), the origin-limited duplicate check with a foreign row inserted directly, and a read that changes no table and publishes nothing. Evidence: the suite passes, and with the duplicate check widened back to every origin its test fails.
- [x] 1.2 Add the origin, `origin` and `origin_seq`, the migration in one transaction, `History.after` and the origin-limited duplicate check in `apps/runtime/src/core/history.ts`, keeping the envelope, `read` and its routes unchanged. Evidence: the new suite and the existing `history-window` tests pass without change.
- [x] 1.3 Measure the migration on a synthetic 100,000-row store with the runtime's database settings and record the time and sizes in the PR's storage assessment.

## 2. Documentation and delivery

- [x] 2.1 Describe the origin, read after N and the storage change in `apps/runtime/README.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 2.2 Run build, typecheck, lint, the runtime unit suite, the scenario catalog and the workflow and docs checks, and record the actual results in the PR.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent review, the focused storage-migration review, merge and installation follow outside this change.
