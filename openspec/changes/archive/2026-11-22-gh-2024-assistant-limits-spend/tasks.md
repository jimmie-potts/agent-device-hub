## 1. Limits and bounds

- [x] 1.1 Red: tests for the doubled limits, the named limit messages, the 32 KiB staging bound and the grown checkpoint and page bounds fail. Evidence: with the previous `LIMITS` restored as a negative control, six of the seven `assistant-spend.test.js` tests fail; `assistant.test.js` and `checkpointer.test.js` were moved to the new bounds.
- [x] 1.2 Set `LIMITS`, the per-call reservation and the limit messages. Evidence: the same tests pass.

## 2. Provider

- [x] 2.1 Red: the adapter tests for the cache marker, a second call's cached prefix and usage by class fail. Evidence: with the cache marker removed as a negative control, the two request-shape tests in `anthropic.test.js` fail.
- [x] 2.2 Add automatic caching and the usage breakdown. Evidence: `anthropic.test.js` passes.

## 3. Spend ledger

- [x] 3.1 Red: ledger tests for pricing, reservation, settlement, refusals, local boundaries and restart, engine tests for reservation before dispatch, unreported and late usage, refusals at the limits, a call already sent and a conversation-level call, and section tests for prices fail. Evidence: with the engine's spend reservation disabled as a negative control, three `assistant-spend.test.js` tests fail; `spend.test.js` and `configure.test.js` were written before the ledger and the price table.
- [x] 3.2 Implement the ledger, the engine wiring, the section's prices and the `spend` route. Evidence: the same tests pass.

## 3a. Review round 1

- [x] 3a.1 Prices optional, unpriced turns and calls refused, a new paid turn refused when a limit's remainder is below the smallest first call, the page naming a missing price, and the exact process-test reservation. Evidence: `configure.test.js`, `spend.test.js`, `assistant-spend.test.js`, `assistant-process.test.js`, `conversation-spend.test.js` and the conversation state browser journey pass.

## 4. Page

- [x] 4.1 Show spend today and this month in Details and the reached limit beside the composer. Evidence: `conversation-spend.test.js` and the conversation state and history browser journeys pass.

## 5. Documentation and archive

- [x] 5.1 Update the companions README. Evidence: readback.
- [x] 5.2 Synchronize `bunny-assistant-tasks` and archive this change. Evidence: `npm run check:workflow` passes.
