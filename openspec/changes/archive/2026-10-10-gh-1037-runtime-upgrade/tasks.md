This checklist covers implementation and disposable source qualification. The
mandatory synchronization/archive, committed independent reviews, CI, protected
merge and established-installation acceptance follow the repository delivery
procedure and [#1037](https://github.com/jimmie-potts/agent-device-hub/issues/1037).
They are not tasks that must precede their own source archive. Source completion
leaves the issue open and the procedure unqualified for routine installed use.

## 1. Release trust and compatibility

- [x] 1.1 Add the current-runtime install-contract mapping and owned adoption boundary; verify receipt fixtures remain valid and review distinguishes first adoption from routine upgrades.
- [x] 1.2 Document explicit merged-release build/archive steps and add only required inventory verification; verify dirty/unknown source, tamper, unsafe paths and same-SHA conflicts refuse in focused tests.
- [x] 1.3 Implement conservative durable-format classification and evidence binding; verify unknown/incompatible recovery refuses with zero service effects.
- [x] 1.4 Execute baseline/candidate/recovery/re-upgrade against production core/module stores with synthetic media; verify latest records, original hashes, references, dedup and no command replay.

## 2. Manual operation guards

- [x] 2.1 Implement the small read-only preflight/evidence helper for one configured installation; verify separate installed/running identities, canonical plan hash and no service or device effects.
- [x] 2.2 Implement exclusive lock, drift recheck and durable intent; verify concurrent operations, changed configuration/protected paths and unresolved intent refuse before stopping a writer.
- [x] 2.3 Document guarded manual stopped-writer backup, atomic release selection and bounded identity/health verification; verify stop/backup/switch/start/health failures produce truthful outcomes.
- [x] 2.4 Document manual latest-state recovery and implement private final receipt/readback; verify failed recovery/finalization retain evidence and prevent replay; retain owned releases without pruning.
- [x] 2.5 Document explicit first-adoption unit override and manual recovery while preserving original bytes; verify fake adoption boundaries and unchanged-unit routine switching.

## 3. Procedure and source delivery

- [x] 3.1 Add the small preflight/receipt entrypoint and exact manual setup procedure, including baseline provenance refusal and separately authorized adoption effects; verify documented commands against disposable fixtures.
- [x] 3.2 Coordinate small AGENTS/SDLC/check registration edits with shared-file owners; run the owning upgrade tests and all applicable build/type/contract/workflow/runtime checks under pinned Node.
