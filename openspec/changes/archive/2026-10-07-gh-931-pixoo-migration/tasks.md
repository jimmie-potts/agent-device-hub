## 1. Reading the installed library

- [x] 1.1 Pin the installed release `1b4115c` and its three migration checksums, read from divoom-app-upgrade's history, and assert that the module's first three migrations are their text: `modules/pixoo/tests/module/migration.test.ts`, "pins the installed release's schema".
- [x] 1.2 Write a synthetic library of schema version 3 with the library's own migrations and media store, with what the migration carries and what it leaves behind (`writeSyntheticLibrary`).
- [x] 1.3 Open the source without changing it: an immutable catalog, a shared owner lock, files opened without following a link. Evidence: "never changes the source library" compares every entry's type, mode, size, modification time and hash, and fails when the catalog opens plainly read-only (mutant M3).
- [x] 1.4 Refuse `source-missing`, `source-in-use`, `source-not-clean`, `source-schema` (application ID, user version, version 4, an added column) and `source-corrupt` (a missing frame, a linked original): "refuses a source it cannot carry safely", each killed by its mutant (M4 to M8).

## 2. The copy

- [x] 2.1 Insert the rows at the installed schema, copy every file the catalog names as a new private file, run the library's forward migration and its own check: "carries every asset, rendition, playlist and item, byte for byte…".
- [x] 2.2 Fail `source-corrupt` when a copy or a manifest does not match its catalog: "a file whose bytes no longer match…" and "a manifest that no longer matches…" (mutant M1).
- [x] 2.3 Show that a rerun gives the same report and files, and that the module starts on the migrated store, serves its renditions and playlists in order and plays one: "a rerun into a fresh destination…" and "the module starts on the migrated store…".
- [x] 2.4 Count large GIF originals without naming them, and keep every report to counts, codes and hashes: "reports counts, codes and hashes only" (mutants M20, M22).

## 3. The verifier

- [x] 3.1 Compare rows, files, modes, the schema and the module's folder, counting each kind: "the verifier counts a planted corruption and stops the cutover", one case per kind (mutants M9 to M15).

## 4. The tool and the runtime's lease

- [x] 4.1 Add `holdRuntimeLease` over the core's `takeLock`, and the tool `migrate-pixoo.js` with its exit codes: `apps/runtime/tests/pixoo-migration.test.ts`.
- [x] 4.2 Refuse `runtime-running` (a real runtime in a child process), and show that a runtime started while the tool holds the lease exits `core-failed` (mutant M16).
- [x] 4.3 Refuse `disk-short` with the space to keep free, `destination-not-empty` and `destination-missing`, and remove what a failed migration wrote (mutants M17 to M19).

## 5. Disposable run, documentation and qualification

- [x] 5.1 Add the `pixoo-migrated` run scenario, which migrates a synthetic library into the run's state directory before the shipped runtime starts: `apps/runtime/verify/tests/migrated.test.ts`.
- [x] 5.2 Document the tool in the runtime README, the migration in the Pixoo module README, the run in the verification README, and the tests and stream owner in `docs/development.md`.
- [x] 5.3 Run build, typecheck, lint, the SDK, runtime, scenario, verification, events, maintenance and Pixoo suites, and the workflow and OpenSpec checks.

## 6. Fix round 1 (PR #994 reviews)

- [x] 6.1 Stop every copy on the first failure or an abort before the migration settles: "a failed read stops every copy…", "an abort stops every copy…" and the tool's "a copy that fails mid-way…", red first.
- [x] 6.2 Run and check the last checkpoint, and fail on a log left after the close: "a log left beside the database…" and the real tmpfs test "on a real full disk…", red first (it reported `migrated` with a log at 340 to 420 KiB).
- [x] 6.3 Keep the cause in the library's errors, stop the transaction helper masking a failed COMMIT, and map a full disk to `disk-short` at every step: "a full database at any step…", red first.
- [x] 6.4 Turn SIGINT and SIGTERM into an abort that stops the copies, removes what was written and exits 4: "an interrupt before anything is written…", red first.
- [x] 6.5 Create nothing on a refusal, refuse folders others may open before the database exists, count whole blocks, refuse a library without its owner lock file or given as a file, count files left in the backup, and check the catalog revision and the module's own tables in the verifier: each with its test, and each killed by its mutant (F1 to F19).
