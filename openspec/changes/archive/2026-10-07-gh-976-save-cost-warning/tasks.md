## 1. The warning

- [x] 1.1 Let the core store take its save limits and a monotonic timer as options, and let the store test world pass a logger, limits and a timer.
- [x] 1.2 Assert, red before the change, that a state block past its limit logs one WARN with its size and one INFO with the size of the first save back within it, and that a save over 100 ms logs one WARN with its time in whole milliseconds rounded up and one INFO once a save is quick again, with a save of exactly 100 ms and the publication after each commit not counted (`apps/runtime/tests/core-store.test.ts`, "a state block past its limit…" and "a save that takes longer than 100 ms…").
- [x] 1.3 Assert that a logger that throws on both records leaves both saves `applied` and committed ("a costly save stands when its record cannot be written"), and that a save a part rolls back changes neither condition ("a save that does not commit changes neither condition").
- [x] 1.4 Measure each committed save in `CoreStore.#commitChange`, from before `apply` to the outbox's commit, and record each condition's transitions after the commit.

## 2. Profile 1.5

- [x] 2.1 Register `storage.cost.high`, `storage.cost.normal`, `bunny.state.bytes` and `bunny.save.duration_ms` as profile 1.5 of artifact 1.5.0, in the catalog, the schema, the TypeScript and Python helpers and the fixtures, with negative controls: a 1.5 record labeled 1.4, a fractional or textual size, and a time over a day.
- [x] 2.2 Write the runtime's records at profile 1.5, check a module's records in the SDK kit at 1.5, and move every pin, the lockfile and the packaging scripts to 1.5.0.
- [x] 2.3 Assert that the core's records are written whole as profile 1.5 module records, and show that the save-cost tests fail against the catalog without profile 1.5.

## 3. Qualification

- [x] 3.1 Show negative controls fail named tests: no records, a record for every save, no recovery INFO, the time rounded down, the logger unguarded, the timer read after the publication's microtask, and a save recorded whether or not it committed.
- [x] 3.2 Run build, typecheck, lint, the SDK, runtime, scenario, verification, event, maintenance, observability and workflow checks, and OpenSpec validation.
- [x] 3.3 Update the diagnostic contract, the observability, runtime and maintenance READMEs, synchronize the affected specifications and archive the change.
