## 1. Contract

- [x] 1.1 Add the profile 2.0 envelope, building block, kind payload and error registry schemas under `packages/event-contracts/schemas/v2/`.
- [x] 1.2 Add `src/v2/index.ts` with `MessageValidator`, `errorBody` and `compareDelivery`, exported as `@jimmie-potts/event-contracts/v2` and held to the strict profile.
- [x] 1.3 Add `fixtures/v2/messages.json` and `tests/v2.test.mjs`, covering each kind, the invalid cases with their expected codes and details, size, expiry, retry identity, registration and the registry; `npm run test:events:built` passes.

## 2. Decision record and docs

- [x] 2.1 Amend ADR 0012 for the revised runtime, transport, storage, outboxes, sync, failure containment, module rules, TypeScript only and the offline cutover, each with its trade-off.
- [x] 2.2 Document profile 2.0 in the package README and `docs/development.md`.
- [x] 2.3 Run build, typecheck, `lint:js`, the event, workflow and preflight checks, then sync and archive this change.
