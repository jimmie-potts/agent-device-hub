## 1. app-verify refusals

- [x] 1.1 Assert the 1.x fields, the exact key set and the registry body on every refusal path, red before the body exists: `tests/error-body.test.mjs` everywhere, and the lifecycle tests on a host with a user manager.
- [x] 1.2 Add `errorBody` to the refusal line and to `stop`'s `receipt-locked` result, from a copied code table; the workspace test proves each body equals the registry's `errorBody`.
- [x] 1.3 Map every refusal in the README, with a test that compares its codes, Retryable column and row count with the core.
- [x] 1.4 Run the package check's consumer outside every checkout, assert that no other workspace package resolves there, and assert that the registry check skips with its printed reason.

## 2. Maintenance intake refusals

- [x] 2.1 Drive the real CLI to a refusal for each code used, red before the body exists, and check that `complete` and `uncertain` responses keep exactly their 1.x fields.
- [x] 2.2 Add `error` to `blocked` responses from a copied code table, with `invalid-state` for a configuration that fails to load; the test proves each body equals the registry's `errorBody`.
- [x] 2.3 Map every reason in the README, with a test that compares codes, Retryable column and row count; the package check asserts the bundled CLI's full blocked response.

## 3. Qualification

- [x] 3.1 Run build, typecheck, lint, the app-verify, maintenance and Hub verify suites and package checks with the user bus hidden, the event and workflow checks, and the lifecycle suites once with the user bus visible.
- [x] 3.2 Show negative controls fail named tests: a dropped or changed code, a flipped retryable flag or README cell, a duplicated README row, a dropped 1.x field, and a core that imports the registry.
- [x] 3.3 Synchronize the affected specifications and archive the change.
