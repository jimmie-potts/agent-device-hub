## 1. Contracts

- [x] 1.1 Red: contract tests for `session/3.2` and `lifecycle/2.4`, their equality with `session/3.1` and `lifecycle/2.3` apart from the companion members, the native-only rule, no companions on title metadata, bounds, duplicate IDs, the version a record is published in, `readSession` and a reader of the previous release. Evidence: with neither version registered, all six tests in `tests/companion-metadata.test.mjs` fail (red run in the PR).
- [x] 1.2 Add both schemas, register them, add `Companion`, the duplicate-ID check, `SESSION_32_SCHEMA` and the record builder's pass-through. Evidence: `npm run test:events:built` passes.

## 2. Companions module

- [x] 2.1 Red: session reporting tests for the companion on every lifecycle observation in `lifecycle/2.4`, a titled and a renamed conversation keeping it, and title metadata in `lifecycle/2.3` without it. Evidence: four tests in `assistant-sessions.test.ts` fail before the module names the companion (red run in the PR).
- [x] 2.2 Name the conversation's companion in `observationOf` and send lifecycle observations in `lifecycle/2.4`. Evidence: `test:companions:built` passes.

## 3. Core and gateway

- [x] 3.1 Red: the `lifecycle/2.4` binding, a `session/3.2` record that keeps its companions through a generated title, a rename and an older observation without them, a Claude record without them, and retention across a restart. Evidence: three tests in `core-native-sessions.test.ts` fail before the core change (red run in the PR).
- [x] 3.2 Bind `lifecycle/2.4` to the producer, refuse it at the gateway's edges, keep the companions on the stored session and its record. Evidence: `test:runtime:built` passes.

## 4. Dashboard

- [x] 4.1 Red: row tests for the tag, the duplicate rule, the Facts value, a shared room's order, sessions without companions and the companion search. Evidence: two tests in `sessions.test.ts` fail before the row change (red run in the PR).
- [x] 4.2 Tag, Facts row, search and the one-line face. Evidence: `test:runtime-dashboard:built` and `companion-session.browser.ts` pass; with the card reverted the journey fails at the Companion fact (negative control in the PR); screenshots at 1280 and 390 px are kept privately.

## 5. Documentation and archive

- [x] 5.1 Contracts README and MAPPING, companions README, dashboard README. Evidence: readback.
- [x] 5.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.
