## Why

Every state message rewrites its entity's record in `core_history_latest`, and any top-level member that differs writes a change row ([#1772](https://github.com/jimmie-potts/agent-device-hub/issues/1772), design [#1768](https://github.com/jimmie-potts/agent-device-hub/issues/1768)). A Wemo plug's reading every 5 s moves `observed.observedAtMs`, so every reading is a row: about 34,000 a day for two plugs, and about half of all stored rows only repeat a reading with a new time. Devices must keep publishing every reading, because live readers take freshness from it (decision 1). The owner chose to keep repeated readings as spans instead (decisions 1, 2 and 4, ADR 0012's amendment of 2026-11-12), and #1771 declared the bookkeeping members that history may ignore.

## What Changes

- **History intake** (`apps/runtime/src/core/history.ts`): a state is compared with the record of its entity's last row by `sameState` from the contracts package's `v2/bookkeeping`, with the family's bookkeeping members. The same state writes no row and updates the entity's open span; a different one writes a change row against the last row's record, with every member that differs, unmasked, and the span it closes. A confirmation of a polled family after a silence longer than four polling intervals, and at least two minutes, writes one gap row. A removal of an entity whose open span holds confirmations beyond its row writes a closing row first. Stale, out-of-order and resent states add nothing.
- **Storage:** a new table `core_history_span`, outside the log, created empty at the store's next open. `core_history_latest` keeps its five columns and now holds the record of each entity's last row. Rows are never updated or deleted; `origin_seq` stays gapless; `after` reads rows only. A span left behind by a release without spans is reset to an unknown start.
- **Change event:** optional `span`, `gapMs` and `closedBy: 'removal'` members.
- **Registration:** `ModuleFactory.polling`, per module and family, the polling interval in milliseconds (the longest when it varies with state). The runtime collects it beside the bookkeeping members and refuses the shipped list at start for a family the module cannot publish or an interval outside 1 ms to one hour. Wemo (`device`, 5 s), Pixoo (`device`, 30 s), Roborock (`roborock-vacuum` and `device`, 60 s) and Weather (`weather-state`, 15 min) declare it. Roborock's two poll intervals become named constants with the same values.
- **Wiring:** the shipped list builds the core with the merged bookkeeping members and polled families; a core built without them uses the contracts package's members and no polled family.
- **Unchanged:** every removal, occurrence, outcome and operation step and their duplicate and conflict verdicts; live readers, publishing, command admission, the maximum-on limit, routines and the dashboard; the read API, the MCP history tool and the Timeline, which pass the new optional members through (#1773 presents them); rows already stored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: "Core history" keeps changes and spans, with scenarios for confirmation, a change with its span, a gap, a removal, stale and resent states, and the previous release on a migrated store.
- `bunny-sdk`: "Module registration" gains the optional `polling` member and its refusal at start, and history now reads the bookkeeping declaration.

## Impact

`apps/runtime/src/core/history.ts`, `store.ts`, `core.ts`, `modules.ts` and the index; `packages/sdk/src/registration.ts`; the Wemo, Pixoo, Roborock and Weather registrations and Roborock's collector constants; runtime tests; `apps/runtime/README.md` and `UPGRADE.md`. A storage change: an additive table in the core store and a changed write path inside the core's commit, which needs a focused second review. Installation and the re-measurement are #1774.
