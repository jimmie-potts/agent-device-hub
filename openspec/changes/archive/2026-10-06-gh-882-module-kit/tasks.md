## 1. Prepared messages

- [x] 1.1 Cherry-pick #883's `Sdk.publishMessage` commit unchanged; its prepared-message tests pass.
- [x] 1.2 Pass `publishMessage` through the runtime's module context, which no longer compiled without it; a context test publishes a prepared message unchanged.

## 2. Outbox

- [x] 2.1 Write the outbox tests against a stub that refuses every call; all 9 fail.
- [x] 2.2 Build `Outbox` (`packages/sdk/src/outbox.ts`); the outbox tests pass, with a tenth for the per-run mark.
- [x] 2.3 Negative controls, each restored: publishing inside `add`, before the commit, fails 7 tests; a `republish` that sends nothing fails the 4 crash and restart tests; resending already published rows fails the once-per-run and per-run-mark tests.

## 3. Module test kit and fixture

- [x] 3.1 Move the manifest checks to the SDK; the runtime's manifest tests pass unchanged.
- [x] 3.2 Write the kit tests against stub checks, the fixture lamp, the stand-in core and the kill test; every kit test fails, and the runtime-hosted lamp and kill tests already pass on the outbox.
- [x] 3.3 Build `ModuleHarness` and the conformance checks; the bulb module passes, each broken variant fails exactly its check, and the fixture lamp passes the kit.
- [x] 3.4 Negative controls, each restored: a kit without the resend check misses a module that publishes its outcome directly; an outbox `republish` that sends nothing fails the kill test and the lamp's outbox check.

## 4. Docs and record

- [x] 4.1 Document the outbox and the kit in the SDK README, the fixture in the runtime README and both in `docs/development.md`.
- [x] 4.2 Validate this change with `--strict`, then sync and archive it; `npm run check:workflow`, `npm run test:workflow` and `openspec validate --specs --strict` exit zero.

## 5. Review fixes (PR #912)

- [x] 5.1 Write the failing tests first: the reviewers' failed-core case, a clean restart that replays no state or occurrence, acknowledged outcomes, async work, a consume-only module, the harness stop and loading the kit without node:test; 9 SDK tests and the kill test fail.
- [x] 5.2 Keep outcomes until `acknowledge(id)`, delete every other message once it has gone out, and remove `retainMs` and the time-based forgetting; every outbox test passes.
- [x] 5.3 Negative controls, each restored: keeping a time-based forgetting fails the failed-core test; keeping states and occurrences for a resend fails 4 tests, the replay test among them; an acknowledgment that deletes nothing fails both acknowledgment tests.
- [x] 5.4 Add the kit's stand-in acknowledgment; the stand-in core sends it and the lamp follows it, and the kill test shows the second restart sending nothing.
- [x] 5.5 Apply the P3 findings: one `keyClassOf` in `routing.ts`, synchronous work typing, the harness's close-free participant and stop deadlines, optional kit fields, `node:test` loaded only by `moduleConformance` (the checks ran under Vitest), the Purpose lines and the stale runtime comment.

