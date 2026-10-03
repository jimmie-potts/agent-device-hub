## 1. Provenance and inspection

- [x] 1.1 Add Hub command modules and read-only plan/status with canonical approval inputs; red/green tests cover dirty source, complete or unavailable comparison, inactive service, baseline/configuration drift and no installation writes.
- [x] 1.2 Adopt the verified contracts 1.2.0 archive in Hub packaging and validate release inventories including dependencies; tests reject tampering, unsafe paths/links and conflicting same-SHA bytes, and extracted package tests pass.

## 2. Compatibility and recovery engine

- [x] 2.1 Implement conservative format qualification and an isolated target-write/previous-reopen probe; prove all named durable records survive and consumed events produce no repeated fake effects, while unknown/incompatible pairs cause zero service stops.
- [x] 2.2 Implement exclusive operation ownership, durable intent, verified writer exit, consistent backup and bounded switching/health; red/green fake-service tests cover concurrent invocation, stop/backup/switch failure and wrong running identity.
- [x] 2.3 Implement one-time adoption and program-only recovery against latest durable state; tests cover known and hash-only legacy provenance, legacy health without build, each interrupted migration boundary, failed health, failed rollback and both shared-layout adoption orders.
- [x] 2.4 Finalize schema-valid receipts before retention; tests inject final-write failure and verify inspectable failure, no blind replay, no pruning before durable success and preservation of referenced/legacy/other-owner paths.

## 3. Procedure and source acceptance

- [x] 3.1 Replace the stale setup update section and add the root declaration plus SDLC pointer; inspect completion/authority/trigger branches, unchanged CLAUDE import and one authoritative procedure.
- [x] 3.2 Run fresh read-only Claude instruction discovery and Codex when available; retain evidence that an upgrade request reaches the procedure and plan checkpoint without effects, or report the allowed Codex availability gap explicitly.
- [x] 3.3 Pass mandatory build/type, Hub/package/MCP/setup, shared contract/lifecycle/state/MCP and workflow checks; retain red/green, package and fake recovery evidence. Source results make no installed or device claim.
- [x] 3.4 Synchronize this source capability and archive the completed source plan before final review; verify the actual specification inventory and workflow checks. Retain real installed acceptance in Hub #427 for the post-merge owner checkpoint.
