## 1. Families

- [x] 1.1 Write `fixtures/v2/families.json` and `tests/families.test.mjs` first: a valid message for every family and kind, invalid cases with their details, and removal, expiry and sync scenarios. Evidence: the tests fail before the schemas exist.
- [x] 1.2 Add the family schemas under `schemas/v2/families/`, `src/v2/families.ts` and the optional `register` check in `src/v2/index.ts`, held to the strict profile. Evidence: `npm run test:events:built` passes, and `tests/v2.test.mjs` covers the check.

## 2. Mapping

- [x] 2.1 Write `MAPPING.md` for every field of the agent-state session record and snapshot, the lifecycle observation, the controller receipt, the moment command and the playback snapshot, with dispositions for fields with no 2.0 home. Evidence: `tests/mapping.test.mjs` finds every 1.x schema field path in the table.
- [x] 2.2 Convert the 1.x lifecycle and snapshot corpora, every receipt shape, and a real agent-state owner's expiry and retirement scenarios through the table's rules. Evidence: each converted message validates, the listed 1.x refusals stay refused, and both consumers hold the owner's records.

## 3. Docs and checks

- [x] 3.1 Document the families in the package README, export `./v2/families` and update `docs/architecture.md`.
- [x] 3.2 Run build, typecheck, `lint:js`, `test:events:built`, `test:events:python`, `test:workflow`, `check:workflow` and strict spec validation, with negative controls; then sync and archive this change.
