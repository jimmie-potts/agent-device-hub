## 1. Reader and intake

- [x] 1.1 Add the pinned native artifact/source, reproducible build and owning CI/development checks; verify JDK synthetic selection, privacy, Unicode, shape/size and deadline cases plus artifact hashes.
- [x] 1.2 Implement the closed TypeScript metadata validator and narrow credential exclusion; demonstrate malformed replies, safe surrounding text, bounds and omission behavior failing before implementation and passing afterward.
- [x] 1.3 Extend the qualified ADB read path with fixed artifact verification and invocation under one deadline; fake shell-v2 protocol tests must cover exact commands, missing/mismatched artifact, cancellation, output bounds and no device inputs.

## 2. Private history and queries

- [x] 2.1 Add immutable intake/session/gap persistence to the existing lease; focused SQLite red/green tests must prove atomic durability, idempotence/conflict, same-title ambiguity, credentials and no expiry/rebuild loss.
- [x] 2.2 Add current-state and conservative occurrence projections; fixed-clock fixtures must cover pause/buffering/seek, content change/exit, source gaps, clock reset and restart without fabricated samples.
- [x] 2.3 Implement indexed cutoff-bound history/detail paging and output limits; tests must cover app/date/title filters, invalid/conflicting cursors, empty search windows, new arrivals, response omissions and storage faults.

## 3. Owner and consumer integration

- [x] 3.1 Enable collection only through private configuration, serialize reads with controls and publish the module-owned state through SDK/outbox; tests must prove control priority, skipped polls, retained restart data and no command replay.
- [x] 3.2 Register shared content/MCP stored-data reads; real loopback MCP SDK and HTTP tests must prove consistent results, read-only authorization, safe failures and zero transport effects from queries.
- [x] 3.3 Extend synthetic registration/runtime scenarios and module documentation; both in-process and remote catalog runs must observe both apps' titles, progress, gaps and retained history.

## 4. Source delivery

- [x] 4.1 Run the applicable module/native, runtime, SDK, contract, MCP, workflow and build/type/lint checks and retain revision-bound results outside source; inspect the actual specification inventory.

## Delivery checkpoint

After the implementation checks pass, synchronize the affected capability,
archive this exact change and validate the archive/spec output. Then obtain
frozen independent Standards,
Specification and disposable Acceptance results, protected merge and applicable
main CI. Reconcile #1040 source acceptance while leaving #1044
installation/client/physical acceptance pending. These delivery gates remain
required and are recorded against the reviewed commit outside this source
checklist; they are not claimed by ticking implementation tasks.
