## 1. Copied code and tests

- [x] 1.1 Copy the renderer, font, drawing, status and now-playing views, the cloud connection, the queue and the installation writer from `controllers/tidbyt`, with provenance notes, under the strict profile and the module boundary (`src/*.ts`).
- [x] 1.2 Convert the copied render, status, now-playing, connection, controller and publisher tests to TypeScript on 2.0 records and a manual clock, keeping their assertions, and map them in the README (`tests/render.test.ts`, `status.test.ts`, `nowplaying.test.ts`, `cloud.test.ts`, `writer.test.ts`).
- [x] 1.3 Replace the Pillow check with `sharp`'s independent libwebp decode, pixel by pixel, with a corrupted golden as its negative control (`tests/golden.test.ts`).

## 2. Module behavior

- [x] 2.1 Assert, red against a module that does nothing (19 of 19 failing), both tiles from synced records, the gate under bursts, the refresh, removal and the listing check, a lost or slow copy, failed, uncertain and held writes, a cloud that does not answer at start, rendering and its end at stop, a restart, the device record, the lease, a database that refuses commits and secrecy (`tests/module.test.ts`).
- [x] 2.2 Implement `createTidbytModule`: the copies, the tiles and their loops, the queue and lease, the device record through the outbox, the refused commands, rendering through `workers.call` and the diagnostics (`src/module.ts`, `src/writer.ts`, `src/lease.ts`).
- [x] 2.3 Add `configure` and the runner conversion that keeps both installation IDs (`src/configuration.ts`, `tests/configuration.test.ts`).
- [x] 2.4 Add the simulated cloud and its picture (`src/simulated.ts`, `src/picture.ts`, `tests/simulated.test.ts`).
- [x] 2.5 Pass the module test kit with the offline check (`tests/kit.test.ts`).

## 3. Runtime

- [x] 3.1 Add the module's factory to the shipped list after the playback and LIFX modules, with its simulated section and its `token` secret.
- [x] 3.2 Add the `tidbyt-tiles` catalog scenario, played in the in-memory harness on both transports, and in disposable runs with the supervisor's simulated cloud over IPC; watch the module's sources and serve its build (`build.test.ts`).
- [x] 3.3 Measure the gate from the moment each request goes out, after the scenario showed two pushes 14.95 s apart when a render sat between the decision and the send.

## 4. Documentation and qualification

- [x] 4.1 Document the module, the conversion and the expected webcam result for #840 in its README; update the runtime and verify READMEs, the old controller's README and `docs/development.md`, and add `test:tidbyt-module:built` to CI.
- [x] 4.2 Run build, typecheck, lint, the module, SDK, runtime, scenario, verify, event, maintenance, Tidbyt controller and workflow checks, and OpenSpec validation, and name each failure that only #967 removes.
- [x] 4.3 Show each protection's mutant fails its named tests.
- [x] 4.4 Synchronize the affected specifications and archive the change.

## 5. Review fixes (PR #973)

- [x] 5.1 Assert, red before the fix, that a restart while a song plays neither removes nor pushes the card while the playback module serves its start-time `unavailable` record, and that a core that serves a moment late never makes the status tile read `FEED ?`; hold each tile for up to 30 s after the start until its copy syncs, and the card while its record is missing or `unavailable`.
- [x] 5.2 Assert, red before the fix, that a stop while a push is in flight leaves the tile's presence unknown, so an idle restart lists and removes it; store each write as uncertain before it goes out.
- [x] 5.3 Assert, red before the fix, that a wall clock set back delays a tile's next write and refresh by at most its wait; take a stored time in the future as now.
- [x] 5.4 Assert, red before the fix, one record per run of the module's own faults with one recovery record, a refused key logged inside a run of other failures, no span for a held call, and a sync that serves only the committed record; implement each.
- [x] 5.5 Correct the README's webcam expectations and diagnostics, the verify README and the core job's row in docs/development.md, and drop the wall-clock assertion from the offline test.
- [x] 5.6 Show each fix's mutant fails its named tests, and rerun the gate.
