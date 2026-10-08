## 1. Tests first

- [x] 1.1 Add `operation` fixtures, a retired-removal scenario and six invalid cases to `fixtures/v2/families.json`.
- [x] 1.2 Write `operation-records.test.ts`: the lifecycle, refusals and deadlines, the bound and a restart, every message validated.
- [x] 1.3 Run the core's conformance kit over `session` and `operation`, check `serves` in the module list, and add the `operation-records` catalog scenario.

## 2. Contracts and core

- [x] 2.1 Add the `operation` schema, `OperationRecord`, `operationEntityId` and its check. Evidence: `test:events:built` passes.
- [x] 2.2 Add the core's `OperationRecords` part, first among the core's parts. Evidence: the runtime test, the conformance run and the scenario pass.
- [x] 2.3 List `serves` in `/api/v2/modules`. Evidence: the gateway tests pass.

## 3. Docs and checks

- [x] 3.1 Document the family, the part and `serves`.
- [x] 3.2 Run the gate and the negative controls; sync and archive this change.
