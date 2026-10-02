## Context

See proposal.md for motivation and the wispr-collector delta for behavior. The current repository uses TypeScript workspaces, Node 24, native node:sqlite elsewhere, direct Node test runners and offline archive checks. There is no Wispr package. The Hub must receive JSON only, so its existing state owner and controller contracts are unaffected.

Native qualification on Windows Node 24.21.0 / SQLite 3.53.4 passed with synthetic data: stable WAL transaction while a writer commits, unchanged database/WAL bytes on quiescent read, rejected writes/extensions, released locks, bounded busy failure and supervised interruption. This qualifies the runtime approach, not the unfinished collector. Final package tests must repeat it.

## Goals / Non-Goals

**Goals:** a small pure aggregate contract plus a Windows CLI; retained contributions that can be replaced exactly; fail-closed source/schema handling; recoverable publication; explicit privacy and freshness state.

**Non-Goals:** source account discovery, transcript archiving, SQLite access from WSL, another server, installation or automatic scheduling. Language analysis remains a separate extension of the declared contract.

## Decisions

### A supervised native reader

Use node:sqlite in a child process with `readOnly`, `query_only`, extension loading disabled and a 1-second busy timeout. Keep the source transaction limited to schema qualification and explicitly selected columns. An async supervisor controls the 10-second read and 60-second run deadlines and can terminate synchronous SQLite work. Enforce row/byte bounds during iteration and memory limits in the worker/supervisor; never accumulate an unbounded IPC payload. A same-process timer cannot interrupt a synchronous query, and copying the main SQLite file would omit live WAL data.

The reader rejects views or incompatible required types and selects a fixed History schema profile. Where an installed source version differs, fail unsupported rather than guess column aliases or inspect private account files. Synthetic fixtures qualify known mappings; installation separately confirms the profile and metric semantics. Required fields are identity, status, words and zoned source time; optional app/duration/counter columns have explicit missing coverage. Numeric mode never selects text. Optional source text selection belongs to the language extension and is separately gated.

### Separate contribution store and control record

Use a private collector-owned SQLite database for numeric contributions keyed by namespace/record ID and persisted collection metadata. Each complete source scan replaces changed contributions in one transaction and marks unseen keys archived. Keep normalized private source times and source offset so explicit zone changes can rebuild numeric groups. Unknown arbitrary source strings do not enter public output. Source presence and eligibility are distinct, including later transitions to ineligible status.

Keep a small durable control record outside restorable backups: current generation, clear/capture watermark and language-clear epoch. All mutations share one lease. Backups are bounded, owner-managed snapshots of collector state, never copies of Wispr. Restore validates both store format and control epochs; old data cannot override newer clear decisions. No silent retention eviction or automatic backup rotation.

Default restore rejects a backup from before a clear. Explicit historical restore imports only that backup's captured numeric contributions; a private per-key exemption lets those contributions receive later source updates without lowering the capture boundary for other old rows. A subsequent clear removes the exemptions. Numeric restore never reenables language. The control record also retains pending cleanup so restart completes removal of text-bearing managed backups and pending publications before exposing recovered state.

The collector lease uses an exclusive transaction in a separate private SQLite lock database. Kernel locks release on process death, avoiding stale PID recovery. The outer run supervisor will hold this lease while one direct worker performs source read, private-store commit and publication; phase messages let the supervisor enforce both the source-read and whole-run deadlines. Clear requests stop the active worker before taking the lease. No nested worker may outlive that supervisor.

### A bounded aggregate contract

Add `packages/wispr-contracts` as a pure schema/validator package and `apps/wispr-collector` as its producer. Export strict typed envelopes, fixtures and validation usable by the Hub without loading SQLite or filesystem code. Keep one versioned app/category mapping and algorithm identity. Daily/hour/app cells carry matching numerator/denominator sums, known/unknown coverage, retained/archive counts and safe categories. Consumers derive selected date/app/category totals from these groups rather than combining incompatible precomputed filters.

The envelope also carries calendar rollups, observed runs, coverage/gaps, fixed preset bounds and optional language/dictionary availability. Exact source timestamps and IDs are never encoded. Collector timestamps establish observation freshness; latest activity is date-only. Optional language tables carry aggregate counts and explicit availability, not records. Strict validation and a 16 MiB serialized cap precede publication.

### Commit before atomic publication

Persist contributions, revision and the pending validated snapshot in one local transaction. Flush a same-directory output temporary file, then replace the aggregate file atomically. Retry pending publication before taking a new observation, under the same lease. A separate sanitized status file records attempts without changing successful data freshness. Failure before commit preserves all previous data; failure after commit preserves a resumable pending revision. A clear advances control authority first and prevents an older pending snapshot from being published; consumers check generation/authority before returning data.

Publication failure and clear failure are visible states. Raw filesystem or SQLite exceptions never become CLI diagnostics. The output path cannot alias config, source or private database. Private ACL/path checks cover existing ancestors, reparse points, cloud folders and Git roots; extension loading stays disabled independently of query-only mode.

### CLI and packaging

Expose one-shot collect, status, numeric JSON/CSV export, backup, restore and explicit clear/reset. Numeric export is the default; text export requires a later separate choice. No timer/service lives inside the CLI. The package includes compiled code, contract assets and runbook; archive tests run without workspace dependencies or repository-relative resolution. Production collect requires Windows; portable pure functions and deliberately named synthetic test adapters support Linux CI without presenting Linux source reads as Windows evidence.


The CLI now runs each operation in one direct worker. The parent owns the run lease
until that child exits; the child also holds an independent worker lease so a
supervisor crash cannot release a still-running writer's ownership. IPC disconnect
ends the child, with connection checks at read, commit and publication boundaries.
Clear uses a generation-specific cancellation token and waits for both leases.
A failed attempt remains in the strict shared status envelope; the next complete
scan records its gap. An interval longer than the planned five-minute cadence is
reported as not observed, without asserting absent dictations or zero usage.

Offline packaging copies only the collector, synthetic tests, the pure contract and
its installed JavaScript dependency closure. It normalizes archive ownership,
permissions and timestamps, includes file hashes, and never runs an installation
script or registry lookup. Backup flushing uses a writable handle to the
collector-owned temporary backup, as required by native Windows; source connections
remain read-only. Fresh-directory restore requires explicit historical approval,
retains the selected source namespace and establishes a current capture fence.


The supervisor reserves its own RSS plus 32 MiB before assigning the worker's
memory ceiling. The worker checks RSS at phase boundaries; the private store
checks during contribution iteration and immediately before transaction commit.
A budget failure rolls back the transaction. A bounded cache of eight date
formatters avoids allocating one native ICU formatter per source row. Native
synthetic qualification includes 100,000 rows and rejection of row 100,001 with
the prior published revision preserved; this is not an installed performance claim.

## Risks / Trade-offs

- Source semantics can change → strict required-schema checks, independent coverage, unsupported diagnostics and installed semantic validation; no claims of sent text or accuracy.
- Full scans may reach configured bounds → explicit capacity status and retained last-good data, with no partial reports or data eviction.
- Windows rename/ACL behavior differs from Linux → native final-collector tests include locked output, redirects, permission rejection and recovery.
- Power loss can interrupt clear → authoritative control epochs fence restore and pending publication; replay/fault tests cover each durable boundary.
- Another coordinator changes shared scripts/CI → isolated worktree, additive changes and current-main reconciliation before integration. No writes to that coordinator's branch.

## Migration Plan

This introduces a new private store format; no live migration is performed by source delivery. The runbook describes owner-authorized first binding, bounded backup, explicit restore and source rebind. Unsupported store versions fail closed. Future format migration requires backup and clear-epoch preservation before conversion. Removing the source package does not delete retained analytics or modify Wispr.

## Open Questions

Installed source field semantics, real-data counts, ACL integration and scheduled task behavior require the separately authorized installation trial. Synthetic source acceptance does not answer those questions.
