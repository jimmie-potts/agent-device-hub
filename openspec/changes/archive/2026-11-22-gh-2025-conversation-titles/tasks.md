## 1. Contracts

- [x] 1.1 Red: contract tests for native title metadata in `lifecycle/2.3`, its equality with 2.2 apart from the metadata members, and the `assistant-control/2.1` rename fail. Evidence: with `lifecycle/2.3` unregistered, two of the three tests in `tests/conversation-titles.test.mjs` fail (negative control in the PR).
- [x] 1.2 Add both schemas, register them and widen `AssistantControl`. Evidence: `npm run test:events:built` passes.

## 2. Core and gateway

- [x] 2.1 Red: the core test for native title metadata fails while the core takes metadata from Codex Desktop only. Evidence: negative control in the PR.
- [x] 2.2 Accept native `metadata-observed`, bind `lifecycle/2.3` to the producer, refuse it from edges, and send a rename as `assistant-control/2.1`. Evidence: `core-native-sessions.test.js` and the gateway rename test pass.

## 3. Companions

- [x] 3.1 Red: unit tests for normalization, the prompt, the Anthropic title call and compare-before-write, and engine tests on the manual clock for the first title, refresh, reappearance, rename, failures and the synthetic title. Evidence: `conversation-titles.test.js`; without the rename's abandon and the generation compare, the rename and compare-before-write tests fail (negative control in the PR).
- [x] 3.2 Implement `titles.ts`, the engine and store wiring, `titleModel` and the rename control. Evidence: `test:companions:built` passes.
- [x] 3.3 Rename in Conversation details. Evidence: the companions browser journey passes.
- [x] 3.4 Reserve and settle each paid title call in #2024's spend ledger as a conversation-level call; an unpriced title model is accepted and its calls are refused by the ledger. Evidence: the spend-limit, missing-price and first-message tests in `conversation-titles.test.js` and `configure.test.js` pass.

## 4. Documentation and archive

- [x] 4.1 Companions README, `THIRD-PARTY-NOTICES.md`, contracts README and MAPPING, provider qualification. Evidence: readback.
- [x] 4.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.

## 5. Review round 1 on PR 2040

- [x] 5.1 No title call for a profile without a real title model; refresh on an accepted coding hand-off; the echo guard before the cut and for cut prefixes, over owner and assistant messages; the raw answer kept privately; optional title-model price. Evidence: the no-title-model, injected synthetic, hand-off, echo, failures and configure tests pass; without the hand-off refresh, the hand-off test fails (negative control in the PR).
