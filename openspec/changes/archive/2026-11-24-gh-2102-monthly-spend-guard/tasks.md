## 1. Configurable monthly guard

- [x] 1.1 Red: section, ledger and module tests for the default guard, a configured $200 guard, refusal at $200 and not at $150, the unchanged daily pacing and invalid values fail. Evidence: before the change the build reports the ledger's extra argument, and `spend.test.js` and `configure.test.js` fail three tests (the parsed section lacks `monthlyLimitMicros`, the ledger's and the route's month limit read $150).
- [x] 1.2 Parse and bound `assistant.monthlyLimit`, pass it through the engine's options to the ledger. Evidence: the same tests pass. Negative controls: without the bounds check `configure.test.js` fails its section test; without passing the section's guard to the engine it fails the module test.

## 2. Page and documentation

- [x] 2.1 Details and the composer notice name the route's configured guard. Evidence: `conversation-spend.test.js` and the conversation state browser journey, whose fixture now carries a $200 guard.
- [x] 2.2 Update the companions README, `apps/runtime/UPGRADE.md` and `docs/development.md`. Evidence: readback.
- [x] 2.3 Synchronize `bunny-assistant-tasks` and archive this change. Evidence: `npm run check:workflow` passes.
