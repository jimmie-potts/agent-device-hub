## Why

The installer ([Hub #935](https://github.com/jimmie-potts/agent-device-hub/issues/935)) reads both migration tools' codes, so the tools should name one condition one way first ([Hub #1003](https://github.com/jimmie-potts/agent-device-hub/issues/1003)). For a log or journal left beside the database after the close, the Pixoo library migration (#931) answers `destination-unclean` and the Nanoleaf migration (#933) `destination-not-clean`. PR #1002's review added the rest, and this change's own work found that the Nanoleaf tool refused a module folder that others may open only after its lease: the SDK, the Nanoleaf module and the Pixoo migration each kept their own full-disk check; the `nanoleaf-module` spec named no code for a store failure; and the runtime README's signal sentence and the Nanoleaf code table were incomplete.

## What Changes

- The Pixoo tool answers `destination-not-clean`, as the Nanoleaf tool does and as `source-not-clean` reads.
- The SDK exports `fullDisk(error)`: `SQLITE_FULL` or `ENOSPC` by code on the error or up to seven causes, never by text. `openModuleDatabaseFile`, the Nanoleaf module and both tools use it in place of their own checks.
- Both tools' entry points take the same `abortOnSignals` (`apps/runtime/src/signals.ts`): the first SIGINT or SIGTERM aborts the run and removes both listeners, so a second stops the process at once, and a signal after the line changes nothing.
- The Nanoleaf tool refuses a `modules/` or `modules/nanoleaf/` folder that is a link, belongs to another user or that others may open with `module-folder-not-private` and exit 3, before it takes the lease, as the Pixoo tool does; both call the runtime's new `freshModule` check before they create anything and again under the lease. Before, it failed with exit 4 after the lease had made its lock file there.
- The `nanoleaf-module` spec names `capacity` for a full store and `internal` for any other store failure.
- Docs: the runtime README's Nanoleaf code table gains an Exit column and the Pixoo table the new code; both tools' signal sentences match a probe; the Nanoleaf README says that a full disk does not always end the whole transaction, and who logs an `internal` refusal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pixoo-library-migration`: "Migration refusals and failures" names `destination-not-clean`.
- `nanoleaf-module`: "Nanoleaf commands and outcomes" names `capacity` and `internal` for store failures, with a scenario.
- `bunny-sdk`: adds "One full-disk test".
- `nanoleaf-migration`: "Migration refusals and failures" names `module-folder-not-private` as a refusal before the lease, with a scenario.

## Impact

- **Code:** `packages/sdk/src/database.ts` and `index.ts`; `modules/nanoleaf/src/sqlite.ts`, `src/module/runtime.ts` and `src/module/edits.ts` (a comment); `modules/pixoo/src/migration/{contracts,migrate,index}.ts` and `src/index.ts`; `apps/runtime/src/{pixoo-migration,nanoleaf-migration,migrate-pixoo,migrate-nanoleaf,signals,state,index}.ts`.
- **Tests:** `packages/sdk/tests/database.test.ts` (new), `apps/runtime/tests/migration-signals.test.ts` and its fixture (new), the Pixoo tool's test, and the Nanoleaf tool's tests (a new test of a folder that is not private).
- **Docs:** the runtime, SDK and Nanoleaf READMEs.
- **Unchanged:** every message, reply and outcome shape. No coordinator-owned file changes.
- **Delivery:** source-only.
