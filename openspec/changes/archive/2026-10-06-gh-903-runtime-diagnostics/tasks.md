## 1. Profile 1.2 of the diagnostic contract

- [x] 1.1 Write failing profile tests (`packages/observability/tests/profile.test.mjs`) and append the profile 1.2 cases to the shared fixture corpus; against artifact 1.1.0, 7 Node tests fail, the shared-corpus test among them.
- [x] 1.2 Add profile 1.2 to the catalog (`additions`, `scope_rules`, the runtime's service, scopes, events and attributes) and the schema (enums, attribute definitions, closure to 1.0 and 1.1, the runtime scopes' rules); bump the artifact, `projectRecord`, the Python version label and the archive script to 1.2.0. Move the `unsupported-1.2` fixture to `unsupported-1.3`. All 24 Node tests, the 13 unchanged Python tests and the query fixture pass.
- [x] 1.3 Move the workspace pins of the Hub, maintenance and the Pixoo media package to 1.2.0, with the archive names in the Hub and maintenance package scripts, and add the dependency to `apps/runtime` and `packages/sdk`; update the lockfile.

## 2. The runtime's records

- [x] 2.1 Write failing runtime tests: contract records in the context, isolation and manifest tests, a validator check of every record `run()` collects, the new `log.test.ts` (process records and instance IDs, the watchdog's record, a closed stderr, a throwing sink, writer counts, error fields) and a scenario test of the harness's records; against the #880 source every test that uses `run()` fails.
- [x] 2.2 Build records with the contract's `createRecord` (`record.ts`), with the resource, the process's instance ID, counts and an EPIPE-proof stderr sink (`log.ts`); log the module scope, registry codes and phases (`host.ts`); pass the resource to the watchdog thread and keep the SDK out of it (`lag.ts`, `watchdog.ts`, `watchdog-worker.ts`).
- [x] 2.3 Move the fixture modules, the process kill test and the scenario catalog to registered events.

## 3. The module test kit

- [x] 3.1 Write failing kit tests for an unregistered event, a runtime event, an unregistered attribute and an invalid value.
- [x] 3.2 Add `checkModuleRecord` and run it on every hosted module's records in each check's verify step.

## 4. Maintenance intake

- [x] 4.1 Add `apps/maintenance/tests/runtime-journal.test.mjs`: the built runtime's stderr lines as a synthetic journal; intake accepts them and finds `runtime.failed`, and refuses #880-format and 1.1-labeled records.

## 5. Launch files, after #920

- [x] 5.1 Rebase onto #920. Add `--environment`, pass the environment and the process's resource to every writer and the watchdog, write `runtime.ready` beside the stdout ready line, and report dropped and failed counts in `runtime.stopped`; verification runs pass `--environment test`.
- [x] 5.2 Register #920's edge events and attributes; replace `bunny.url` with `server.port` and the meaning sentence in `bunny.reason` with the code's registered reason, and keep the edge's detail out. Add fixtures for the grant codes, the edge records and their negative controls.
- [x] 5.3 Make `build-current` watch the contract's sources and outputs; `test:runtime:verify:built` passes with the user bus hidden (17 pass, 2 skipped) and with the user manager (19 pass), and leaves no unit.

## 6. Docs, validation and archive

- [x] 6.1 Update the contract, the observability, runtime, SDK, maintenance and Pixoo READMEs, and `docs/development.md`.
- [x] 6.2 Negative controls, each reverted: writing what the contract refused fails 2 runtime tests; registering `error.message` fails 2 Node, 1 Python and 1 runtime test; a resource without its fields fails 8 runtime tests; module records under `bunny.runtime` fail 4 runtime tests, and dropping the schema's `bunny.runtime` rule fails 2 Node tests and 1 Python test; removing the kit check fails 2 kit tests; a sink failure that reaches the caller fails 3 tests; the meaning sentence in `bunny.reason` fails 1 edge test; ignoring `--environment` fails 2 process tests.
- [x] 6.3 Run the gate from a fresh build, validate this change with `--strict`, then sync and archive it.
