## 1. Package and durable owner

- [x] 1.1 Add the workspace, build/type commands and CI checks before product implementation; verify Node 24 setup and a failing persistence/restart test.
- [x] 1.2 Implement exclusive host storage, atomic commits, persisted labels/notices, restart uncertainty and journal maintenance; verify failed/ambiguous commits, competing owners, 24-hour and 10,000-event retention.

## 2. Lifecycle and consumers

- [x] 2.1 Implement independent lifecycle dimensions, deterministic reduction, scoped acknowledgment, stale-turn rejection and deduplication; verify fake-clock, reordered, concurrent and missing-identity scenarios with focused red/green tests.
- [x] 2.2 Implement immutable snapshots, freshness and evidenced child aggregation; verify five-minute uncertainty, restart recovery, stable child counts and separate collector health.
- [x] 2.3 Implement bounded independent subscriptions and admission; verify two healthy consumers plus a stalled third, queue/byte caps, expired cursors and snapshot resync without effects.

## 3. Provider delivery and compatibility

- [x] 3.1 Implement qualified source normalizers and silent bounded emitters; verify privacy canaries, missing/unsupported evidence, disabled paths, collector failure, saturation and process deadline behavior.
- [x] 3.2 Implement versioned export/import and TypeScript/Python snapshot consumers; verify identity/revision/notice preservation, incompatible data rejection, interruption and explicit rollback.
- [x] 3.3 Package reproducible immutable artifacts with verified lifecycle dependency; verify external installation, TypeScript imports/declarations, Python fixtures, hashes and repeated archive bytes.

## 4. Delivery evidence

- [x] 4.1 Update architecture/development/package documentation and guide inputs/output; verify generation, maintenance tests, browser checks and complete diff inspection while retaining source/installed/physical distinctions.
- [x] 4.2 Run all applicable existing and new checks, record the actual specification inventory, synchronize both capabilities and archive before fixed-comparison independent review; keep revision-dependent CI/review evidence outside this commit.
