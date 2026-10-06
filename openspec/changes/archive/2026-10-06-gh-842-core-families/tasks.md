## 1. Families

- [x] 1.1 Write `fixtures/v2/families.json` and `tests/families.test.mjs` first: a valid message for every family and kind, invalid cases with their details, and removal, expiry and sync scenarios. Evidence: the tests fail before the schemas exist.
- [x] 1.2 Add the family schemas under `schemas/v2/families/`, `src/v2/families.ts` and the optional `register` check in `src/v2/index.ts`, held to the strict profile. Evidence: `npm run test:events:built` passes, and `tests/v2.test.mjs` covers the check.

## 2. Mapping

- [x] 2.1 Write `MAPPING.md` for every field of the agent-state session record and snapshot, the lifecycle observation, the controller receipt, the moment command and the playback snapshot, with dispositions for fields with no 2.0 home. Evidence: `tests/mapping.test.mjs` finds every 1.x schema field path in the table.
- [x] 2.2 Convert the 1.x lifecycle and snapshot corpora, every receipt shape, and a real agent-state owner's expiry and retirement scenarios through the table's rules. Evidence: each converted message validates, the listed 1.x refusals stay refused, and both consumers hold the owner's records.

## 3. Docs and checks

- [x] 3.1 Document the families in the package README, export `./v2/families` and update `docs/architecture.md`.
- [x] 3.2 Run build, typecheck, `lint:js`, `test:events:built`, `test:events:python`, `test:workflow`, `check:workflow` and strict spec validation, with negative controls; then sync and archive this change.
- [x] 3.3 Reword evidence `none` as "no evidence that anything reached the device" in ADR 0012, the package README, `kinds.schema.json`, MAPPING.md, design.md and the "Completed outcomes and replies" requirement, as the coordinator decided on 2026-10-06. Evidence: the `mode-set-lost-answer` fixture (uncertain, `none`) passes and a succeeded outcome with `none` evidence is refused.

## 4. Review round 1

- [x] 4.1 P2-1: carry the item's own turn in `attention-raised` and `attention-cleared`, rename the cause `turn-started` to `turn-retired`, and refuse a raised item from another turn. Evidence: the `attention-cleared-retired` fixture (a turn-started in T2 clearing an unknown-ID approval from T1) passes, and an item without its turn is refused.
- [x] 4.2 P2-2: map every receipt with `possible` prior effects to `uncertain`, `none` and `uncertain-result`, with the 1.x code in `detail`, and state the receipt rule once in MAPPING.md. Evidence: `tests/mapping.test.mjs` asserts the result, evidence, code and detail of every `possible` receipt shape.
- [x] 4.3 Add the remaining checks and their fixtures: lifecycle and entity subjects, occurrence ordering authority, the inbox session link, generation after revision, freshness against the envelope time, the unevaluated property name and checks that throw or answer empty. Evidence: each new invalid fixture fails where it says, and `tests/v2.test.mjs` covers the misbehaving checks.
- [x] 4.4 Keep entities above the sync revision in the reference consumer, declare the test devDependencies, add the inbox operation's optional evidence and the monotonic deadline sentence, complete MAPPING.md's publish table, and update the docs. Evidence: the sync probe scenario passes, and the lockfile diff adds only the two devDependencies.
