## 1. Tests first

- [x] 1.1 Add `operation` fixtures, a retired-removal scenario and seven invalid cases to `fixtures/v2/families.json`.
- [x] 1.2 Write `operation-records.test.ts`: the lifecycle, refusals/deadlines, pending excess and late-retired pruning, expiry/conflicts, trace continuity, atomic rollback and stored-message restart, every message validated. Evidence: 12 focused tests pass, including equal-time retirement ordering and tracker/history preservation.
- [x] 1.3 Run the core's conformance kit over `session` and `operation`, check `serves` in the module list, and add the `operation-records` catalog scenario.

## 2. Contracts and core

- [x] 2.1 Add the `operation` schema, `OperationRecord`, `operationEntityId` and its check. Evidence: `test:events:built` 167/167 passes.
- [x] 2.2 Add the core's `OperationRecords` part, first among the core's parts. Evidence: runtime 382/382, including the core conformance kit; scenarios 67/67, including operation-records over both transports; supervisor 67/67 passes.
- [x] 2.3 List `serves` in `/api/v2/modules`. Evidence: gateway 24/24 passes, including authenticated operation reads and module registration states.

## 3. Docs and checks

- [x] 3.1 Document the family, the part and `serves`.
- [x] 3.2 Run the gates and negative controls; synchronize both specs and prepare the validated change for archive. Evidence: build/type/lint, all focused and broad checks, three killed mutants and rebuilt supervisor 67/67 pass; both delta specs match their main requirements.
