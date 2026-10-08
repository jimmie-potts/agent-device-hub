## 1. One full-disk test

- [x] 1.1 Test `fullDisk` first: a real full database, an extended code, `ENOSPC`, causes one and seven deep, a bound at the eighth, and other codes, text alone, non-objects and a cycle (`packages/sdk/tests/database.test.ts`); it failed to compile before the export.
- [x] 1.2 Export it from the SDK and use it in `openModuleDatabaseFile`, the Nanoleaf module, the Pixoo migration and both tools; remove the copies. Negative controls: without the `ENOSPC` branch, or without following causes, the SDK test fails.

## 2. One leftover-log code and the signal sentence

- [x] 2.1 Rename the Pixoo tool's `destination-unclean` to `destination-not-clean` in its code, test, README and spec.
- [x] 2.2 Share `abortOnSignals` between both entry points, and probe a signal after the line (`apps/runtime/tests/migration-signals.test.ts`): the process exits with the line's code. Negative control: listeners removed after the line, as the old Pixoo entry point did, make it end by the signal.

## 3. One fresh-module check

- [x] 3.1 Test first that the Nanoleaf tool refuses a `modules/` or `modules/nanoleaf/` folder that others may open, or that is a link, with `module-folder-not-private` and exit 3, before the lease, writing nothing through the link or otherwise; it failed with exit 4 before the change.
- [x] 3.2 Add `freshModule` to the runtime's state rules and call it from both tools before they create anything and again under the lease. Negative control: with the Nanoleaf tool's first check moved back after the lease, the test fails because the lease made its lock file.

## 4. Specs and docs

- [x] 4.1 Name `capacity` and `internal` for store failures in `nanoleaf-module`, add the SDK's requirement, and update the runtime, SDK and Nanoleaf READMEs.
- [x] 4.2 Name `module-folder-not-private` in `nanoleaf-migration` and split the runtime README's Nanoleaf row, so it is exit 3 and `module-db-not-private` exit 4.
- [x] 4.3 Run build, typecheck, lint, the SDK, Pixoo, Nanoleaf, runtime, scenario and verification suites, and the workflow and OpenSpec checks.
