## Why

The cutover ([Hub #840](https://github.com/jimmie-potts/agent-device-hub/issues/840)) replaces the Pixoo service with the runtime's Pixoo module ([#843](https://github.com/jimmie-potts/agent-device-hub/issues/843)). The owner chose to migrate the Pixoo media originals and playlists (decision 10, 2026-10-06), with the renditions copied beside them because AGENTS.md protects referenced renditions and copying costs less than rendering again. Controller and playback checkpoint state starts fresh. [Hub #931](https://github.com/jimmie-potts/agent-device-hub/issues/931) is that migration: the library half of the Pixoo move, run offline by the installer ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)) because a long copy inside a module's start would trip the runtime's 10 s lag limit (#880). The installed Pixoo service runs divoom-app-upgrade at `1b4115c`, whose library is schema version 3; the tool supports that version only (owner decision, 2026-10-07).

## What Changes

- An offline tool, `node apps/runtime/dist/src/migrate-pixoo.js migrate|verify --library <dir> --state-dir <dir>`, with one JSON line of counts, codes and SHA-256 digests (`pixoo-migration/1.0`) and the exit codes 0 (done), 1 (mismatch), 2 (usage), 3 (refused, nothing written) and 4 (failed after writing began; what it wrote is removed).
- `migrate` reads the installed library without changing it, carries its assets, renditions, playlists and items into the module's SQLite file through SQLite, copies every original and rendition file into the module's private folder, then runs the library's own forward migration (version 3 to 4) and its own check of every copy against the hashes its catalog gives. Sessions, the playback checkpoint and pending cleanups start fresh and stay in the backup. It does not precompute the module's hosted checks: the module's first start checks each pre-existing hosted multi-frame rendition once, in the background (#843).
- `verify` compares every carried row and every file's SHA-256 with the source, checks the destination's schema and modes, and counts each mismatch by kind.
- Refusals: a runtime holding the state directory (`runtime-running`), too little free space (`disk-short`), a module that already has files (`destination-not-empty`), a running Pixoo service (`source-in-use`), an uncleanly closed library (`source-not-clean`), another schema (`source-schema`) and a damaged library (`source-corrupt`).
- `holdRuntimeLease(stateDir)` in `apps/runtime`: an offline tool takes the core's lease (#831) without waiting, so no runtime starts on the state directory while it runs. #933's Nanoleaf migration reuses it.
- A synthetic library of the installed schema version, built with the library's own code, for the tests and for a disposable run, `pixoo-migrated`, that migrates one into its state directory before the shipped runtime starts on it.
- The report counts GIF originals whose canvas is over 4,096 x 4,096 pixels, which the module plays from their stored renditions but no longer renders again (#843). It never names them.

## Capabilities

### New Capabilities

- `pixoo-library-migration`: the offline migration of the Pixoo service's library into the Pixoo module's store, its verifier, its refusals and its output.

### Modified Capabilities

- `bunny-runtime`: adds "Offline tools hold the runtime's lease" and "A disposable run on a migrated Pixoo library". No existing requirement changes.

## Impact

- **Code:** `modules/pixoo/src/migration/` (new); `modules/pixoo/src/library/library.ts` exports `CALLER_TABLES`; `apps/runtime/src/lease.ts`, `pixoo-migration.ts` and `migrate-pixoo.ts` (new); `apps/runtime/src/core/store.ts` exports `takeLock`; `apps/runtime/verify/seed.ts` (the `pixoo-migrated` run).
- **Tests:** `modules/pixoo/tests/module/migration.test.ts` (in `test:pixoo:built`), `apps/runtime/tests/pixoo-migration.test.ts` (in `test:runtime:built`) and `apps/runtime/verify/tests/migrated.test.ts` (in `test:runtime:verify:built`).
- **Lint:** `eslint.config.mjs` lists the tool's entry point among the stream owners.
- **Docs:** the Pixoo module, runtime and runtime verification READMEs; `docs/development.md` (coordinator-owned) for the stream owners' row and the Pixoo module checks.
- **Unchanged:** the module's records, commands and store, the core, and every other module. No root manifest, lockfile or CI change.
- **Delivery:** source-only. The installer (#935) runs the tool at the cutover (#840).
