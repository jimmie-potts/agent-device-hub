## 1. Declaration and checks

- [x] 1.1 Write the contracts package's tests first (`packages/event-contracts/tests/bookkeeping.test.mjs`): every state family of the package classified, a new family failing the check, each never-bookkeeping name refused, pointers checked through `$ref`, `allOf`, `oneOf` and `anyOf`, settings families declaring none, and every other leaf of each state fixture counting as a change.
- [x] 1.2 Add `v2/bookkeeping` with the map, the rules, `withoutBookkeeping`, `sameState` and `leafMutations`; export the art state families. Verify with the tests above.
- [x] 1.3 Add `ModuleFactory.bookkeeping`, the Pixoo, Roborock and LIFX declarations, and `moduleBookkeeping` in the runtime with the refusal in `shippedList`. Verify with `apps/runtime/tests/bookkeeping.test.ts`: the classification table equals the declarations, a module redeclaring `device` is refused, and the leaf-mutation check over the declared module families' fixtures.
- [x] 1.4 Show the negative controls: an unclassified family and a changed entry fail the table test; each deny-listed name and a pointer to an undeclared member are refused.

## 2. Documentation and delivery

- [x] 2.1 Describe the declaration in `packages/event-contracts/README.md`.
- [x] 2.2 Run build, typecheck, lint, the contract, event, SDK, runtime, Pixoo, Roborock and LIFX suites, the Python contract checks and the workflow checks; record the actual results in the pull request.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent review follows; nothing is installed until #1772.
