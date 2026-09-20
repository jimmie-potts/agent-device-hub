## Why

[Hub #3](https://github.com/jimmie-potts/agent-device-hub/issues/3) needs one reusable interpreter so independent device consumers agree on agent observations and survive host restarts. The lifecycle contract from #2 and the early Linux budget artifact from #30 are available; embedding in Pixoo remains [Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31).

## What Changes

- Add `packages/agent-state` with deterministic reduction, independent attention/notices/read evidence, durable revisions, freshness, bounded subscriptions and a host-owned transactional storage interface.
- Add source-qualified Codex and Claude normalization and silent bounded emitters. Preserve unknown coverage and leave installed-path enablement to #8.
- Separate durable state, labels and notices from the diagnostic journal. Retain at most 24 hours and 10,000 diagnostic events.
- Export versioned snapshot and migration contracts with TypeScript/Python consumer fixtures and reproducible private archives.
- Add executable failure, concurrency, privacy, retention, restart and package checks to the existing CI. Reconcile maintained documentation and guide inputs.

## Capabilities

### New Capabilities

- `agent-state-core`: Shared interpretation, persistence, revisioned snapshots, consumer isolation and migration.
- `agent-provider-emitters`: Allowlisted provider normalization and bounded observational delivery.

### Modified Capabilities

None. Lifecycle contract 1.0 and controller contracts keep their existing wire meanings.

## Impact

New shared package and provider source modules, root workspace/build scripts, lockfile, CI, development/architecture documentation and the work guide. The first host supplies exclusive storage ownership and atomic persistence. This delivery adds no production listener, installed hooks, device commands or second state owner. Consumer adoption, standalone hosting, installed-client coverage and physical acceptance retain their own issues.

Assessment at base `514b566279f271451e36a5bb86b166bfa2a33bd8`: high complexity for concurrent state transitions and recovery; medium uncertainty for documented provider coverage with explicit unknowns; high impact for private payload handling and durable notice correctness. Evidence will include negative privacy tests, interrupted commits, duplicate/reordered observations, independent consumers and migration rollback. Independent Standards and Specification reviews must cover those risks. Reassess if provider evidence, source contracts or the frozen budgets change.
