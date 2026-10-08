## Why

The cutover ([Hub #840](https://github.com/jimmie-potts/agent-device-hub/issues/840)) replaces codex-nanoleaf's Linux bridge with the runtime's Nanoleaf module ([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)). The owner chose to migrate the Nanoleaf layout, preferences, project map and colors, palette, scenes and favorites, and the device addresses and credentials (decision 10, 2026-10-06). Tasks, reservations, epochs, display caches and the controller ledger start fresh, and the #26 decision keeps the whole old `status.sqlite` in the backup and imports no legacy rows or `bindings`. [Hub #933](https://github.com/jimmie-potts/agent-device-hub/issues/933) is that migration, run offline by the installer ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)) before the runtime's first start. The installed bridge's schema-defining files are those of codex-nanoleaf `c711e18`, the commit the port came from, so the installed `status.sqlite` has the schema the port models. The enrollment command waits until it is needed (owner decision, 2026-10-07).

## What Changes

- An offline tool, `node apps/runtime/dist/src/migrate-nanoleaf.js migrate|verify --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>`, with one JSON line of counts, codes and SHA-256 digests (`nanoleaf-migration/1.0`) and the exit codes 0 (done), 1 (mismatch), 2 (usage), 3 (refused, nothing written) and 4 (failed after writing began; what it wrote is removed).
- `migrate` reads the bridge's state directory without changing it, holding a read lock on `status.sqlite` and on the bridge's worker, registry and layout locks. It carries, for each registered device, the projects and colors, palette, each element's project and halves, map settings, a pending wall edit, favorites, each device's mode, revisions and native overrides, the layout and the scene files into the module's store and folder, through SQLite and as new private files. It converts the registry into the module's section with each token as a private secret file, and the shared-input configuration's qualified sources without its `bindings`.
- `verify` compares every carried row with its storage class, every file, the section and every secret file, read through the runtime's own secret reader, checks that everything else starts fresh, and counts each mismatch by kind.
- Refusals: a runtime holding the state directory (`runtime-running`), a destination that already has files (`destination-not-empty`), a secrets directory or section folder that is not private, a bridge process holding the source (`source-in-use`), a journal to roll back (`source-not-clean`), another schema (`source-schema`), damaged files (`source-corrupt`), a registry the module cannot take (`source-config`, `source-device-id`) and a bridge that never configured shared input (`source-not-configured`).
- `holdRuntimeLease(stateDir)` in `apps/runtime`, the same helper as #931's, so no runtime starts on the state directory while the tool runs; the runtime's `loadSecret` is exported for the verifier.
- A synthetic bridge state of the installed shape, built with the port's own code, for the tests and for a disposable run, `nanoleaf-migrated`, that migrates one into its state directory and configuration before the shipped runtime starts on them.
- No enrollment command: an address change is a one-line edit of the device's `address` in the module's section.

## Capabilities

### New Capabilities

- `nanoleaf-migration`: the offline migration of the Nanoleaf bridge's state into the Nanoleaf module's store, folder and section, its verifier, its refusals, its output and its disposable run.

### Modified Capabilities

None. The module's records, commands and store schema are unchanged.

## Impact

- **Code:** `modules/nanoleaf/src/migration/` (new); `modules/nanoleaf/src/scenes.ts` exports `validSceneState`, which `SceneRestorer` now uses; `apps/runtime/src/lease.ts` (the same file as #931's), `nanoleaf-migration.ts` and `migrate-nanoleaf.ts` (new); `apps/runtime/src/core/store.ts` exports `takeLock` (as #931 does) and `apps/runtime/src/host.ts` exports `loadSecret`; `apps/runtime/verify/seed.ts` (the `nanoleaf-migrated` run and the scenarios' `prepare` hook, as #931 adds it).
- **Tests:** `modules/nanoleaf/tests/migration.test.ts` (in `test:nanoleaf:built`), `apps/runtime/tests/nanoleaf-migration.test.ts` (in `test:runtime:built`) and `apps/runtime/verify/tests/nanoleaf-migrated.test.ts` (in `test:runtime:verify:built`); the module's test world takes a `secrets` option.
- **Lint:** `eslint.config.mjs` lists the tool's entry point among the stream owners.
- **Docs:** the Nanoleaf module README and PORTING.md, the runtime and runtime verification READMEs, and `docs/development.md` (coordinator-owned) for the stream owners' row, the runtime and verification checks and the Nanoleaf port's tests.
- **Unchanged:** the module's records, commands and store, the core, and every other module. No root manifest, lockfile or CI change.
- **Delivery:** source-only. The installer (#935) runs the tool, its conversion and its verifier at the cutover (#840).
