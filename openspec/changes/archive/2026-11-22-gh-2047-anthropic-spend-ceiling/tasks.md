## 1. Prices

- [x] 1.1 Red: ledger and section tests for the dated table, the Haiku tier, configured overrides and the dearest rate fail. Evidence: with the Opus entry renamed in the table as a negative control, `spend.test.js` and `configure.test.js` fail.
- [x] 1.2 Add the table and the lookup, and remove the missing-price refusal. Evidence: the same tests pass.

## 2. Spend-limit refusals

- [x] 2.1 Red: adapter, section and engine tests for the documented refusals and the unmapped 400 and 429 answers fail. Evidence: with the mapping and the message disabled as negative controls, `anthropic.test.js`, `configure.test.js` and `assistant-spend.test.js` fail.
- [x] 2.2 Map the refusals and save the fault's message. Evidence: the same tests pass.

## 3. Page and documentation

- [x] 3.1 Label the month as an estimate, add the Console line and the price source. Evidence: `conversation-spend.test.js` and the conversation state browser journey pass.
- [x] 3.2 Update the companions README, `apps/runtime/UPGRADE.md` and `docs/development.md`. Evidence: readback.
- [x] 3.3 Synchronize `bunny-assistant-tasks` and archive this change. Evidence: `npm run check:workflow` passes.
