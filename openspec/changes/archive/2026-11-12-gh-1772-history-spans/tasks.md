## 1. Polling declaration

- [x] 1.1 Add `ModuleFactory.polling`, `modulePolling` and `historyRules` with the refusal in `shippedList`, and the checked-in table of every registered module. Verify with `apps/runtime/tests/history-spans.test.ts`: the table equals the declarations, and an unknown family and each out-of-range interval are refused.
- [x] 1.2 Declare Wemo, Pixoo, Roborock and Weather from each module's own constant, naming Roborock's two intervals.

## 2. History intake

- [x] 2.1 Write the tests first on a controlled clock: confirmations, a change with its span, the gap and its threshold, a family with no gap rule, removal, stale, out-of-order and resent states, a reopen and a restart longer than the gap, a rebuilt record, the power-limit record, the leaf-mutation check through the core store, a rolled-back group, the fact log and the duplicate check, the previous release on a migrated store, and the migration itself.
- [x] 2.2 Add `core_history_span`, the comparison with `sameState`, gap rows, the closing row before a removal and the stale-span reset; pass the rules from the shipped list through the core and its store.
- [x] 2.3 Show the negative control: the new intake tests fail on main's history.

## 3. Documentation and delivery

- [x] 3.1 Update `apps/runtime/README.md` "History" and `apps/runtime/UPGRADE.md`.
- [x] 3.2 Run build, typecheck, lint, the runtime, SDK, event and contract suites, the module suites for the changed registrations, the scenario catalog and the workflow checks; record the results in the pull request.
- [x] 3.3 Sync and archive this change on the delivery branch. Independent review and a focused storage review follow; installation is #1774.
