## 1. The guard in app-verify

- [x] 1.1 Assert, red before the guard exists, that a guarded second `start` is refused with `run-active` and the `capacity` body, names the live run, creates nothing and leaves the run untouched, for the same adapter and another one: `tests/single-run.test.mjs`.
- [x] 1.2 Assert that two starts begun together cannot both pass, that a held claim refuses a start and a dead holder's claim goes, and that only a live run unit counts: a failed unit, a stray lease timer, a lease service and the host route's command unit never block; values other than `1` and the unguarded suites are unaffected; `restart`, `scenario`, `doctor` and `stop` work; an unreadable list lets the start go ahead and says so; a guarded start without a user manager still exits 3.
- [x] 1.3 Add `liveRuns`, `runActiveDetail` and the `start` option; map `run-active` to `capacity` in the core, the README table and the test helper.

## 2. Wrappers

- [x] 2.1 Opt in the `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts and the host route's environment, and assert it, and that no `test:` script opts in.
- [x] 2.2 Make the composition one run: refuse beside a live run, and start its three runs without the variable; assert both against real units.

## 3. Messages and documentation

- [x] 3.1 Reword the unknown-scenario and not-running refusals and assert their text, including the unit and identity cases.
- [x] 3.2 Document the guard in the core README, `docs/app-verification.md`, `docs/sdlc.md` and `docs/development.md`, with a test that the README's example line is what the core prints.

## 4. Qualification

- [x] 4.1 Run build, typecheck, lint, the app-verify, Hub, runtime and CHOMPI verify suites and the package check, the launcher tests and the workflow checks, with the user bus visible for the lifecycle suites.
- [x] 4.2 Show negative controls fail named tests: the guard removed, the guard applied to a suite that starts runs concurrently, a guard that counts every `app-verify-*` unit, a guard without the claim for starts begun together, and a composition that passes the variable to its runs.
- [x] 4.3 Synchronize the affected specification and archive the change.
