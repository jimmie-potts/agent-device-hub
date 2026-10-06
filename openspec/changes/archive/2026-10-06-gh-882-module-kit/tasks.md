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
