## 1. Reading the bridge's state

- [x] 1.1 Read `status.sqlite`, `config.json`, `layout.json` and the scene files without changing them: a read-only `status.sqlite` with a held read transaction, shared locks on the worker, registry and layout lock files, JSON files opened without following a link (`InstalledState`). Evidence: `modules/nanoleaf/tests/migration.test.ts`, "never changes the source state" and "refuses a database with a journal to roll back", which fails when the source opens read-write (mutant M1).
- [x] 1.2 Refuse `source-missing`, `source-schema` (model version 3, an added column, WAL), `source-corrupt` (a damaged layout or scene file, a linked `config.json`), `source-config` and `source-device-id`: "refuses a state it cannot carry safely, naming the code".
- [x] 1.3 Refuse a running worker or enrollment (`source-in-use`), and keep a worker that starts meanwhile and every bridge writer out while the tool reads: "refuses a running worker…" (mutants M2, M3).
- [x] 1.4 Write a synthetic state of the installed shape with the port's own code (`writeSyntheticNanoleafState`), with what the migration carries and what it leaves behind.

## 2. The copy and the conversion

- [x] 2.1 Create the destination with the module's own schema code and copy the carried tables and `meta` values of the registered devices by SQL, then the layout and scene files as new private files: "the linux-state-v4 fixture" and "the installed shape" suites (mutants M4 to M7).
- [x] 2.2 Convert the registry into the module's section with each token as a secret, dropping `bindings` and the 1.x feed's settings: "the configuration conversion" suite, including its refusals (`source-not-configured`, `source-config`).
- [x] 2.3 Show that the module starts on the migrated store with the converted section, shows the migrated preferences, selects shared input at its first sync, and keeps a device's preferences across an address change: "the module on the migrated store" suite.
- [x] 2.4 Keep every report to counts, codes and hashes: "reports counts, codes and hashes only".

## 3. The verifier

- [x] 3.1 Compare rows with their storage classes by key, the schema, what starts fresh, files and modes and the folder, counting each kind: "the verifier" suite, one case per kind and a missing database (mutants M8 to M11).
- [x] 3.2 Compare the section and every secret file through the runtime's own reader, from the section file or the configuration file: `apps/runtime/tests/nanoleaf-migration.test.ts`, "verify exits 1 and counts a changed secret…" and "verify reads the section from the runtime's configuration file…" (mutants R2, R3).

## 4. The tool and the runtime's lease

- [x] 4.1 Add `holdRuntimeLease` (#931's helper, byte-identical) and the tool `migrate-nanoleaf.js` with its exit codes, its JSON line and its entry point: `apps/runtime/tests/nanoleaf-migration.test.ts`.
- [x] 4.2 Refuse `runtime-running` (a real runtime in a child process), and show that a runtime started while the tool holds the lease exits `core-failed` (mutant R1).
- [x] 4.3 Refuse `destination-not-empty`, `destination-missing`, `secrets-dir-refused` and `section-dir-refused` before writing, write each token alone in a private file, and remove what a failed migration wrote, leaving another process's file (mutants R4, R5, R7).
- [x] 4.4 Keep the token out of every line, the section and the module's store (mutant R6).

## 5. Disposable run, documentation and qualification

- [x] 5.1 Add the `nanoleaf-migrated` run scenario, which migrates a synthetic state into the run and its configuration before the shipped runtime starts: `apps/runtime/verify/tests/nanoleaf-migrated.test.ts`.
- [x] 5.2 Document the tool in the runtime README, the migration in the Nanoleaf module README and PORTING.md, the run and the reviewer's steps in the verification README, and the tests and stream owner in `docs/development.md`.
- [x] 5.3 Run build, typecheck, lint, the SDK, runtime, scenario, verification, events, maintenance and Nanoleaf suites, and the workflow and OpenSpec checks.
