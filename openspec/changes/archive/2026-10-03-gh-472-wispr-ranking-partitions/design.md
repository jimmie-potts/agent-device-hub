## Context

See proposal.md for the observed installed failure. The current store supplies fresh iterators inside one transaction; each contribution contains distinct-record counts. The mutable source is scanned once per collection and then language derivatives are replayed from the private store.

## Goals / Non-Goals

**Goals:** Fit larger exact ranking batches without widening memory or key bounds. Preserve all tables, support, deterministic ties, omitted counts, coverage and transactional recovery.

**Non-Goals:** Incremental ingestion, approximation, retained original text, new schema, source access changes, new dependencies or installed acceptance inferred from fixtures.

## Decisions

1. Keep one partition for the ordinary path. If the internal active-key guard overflows, release every partial map and retry that same batch with sixteen deterministic key partitions. Retry only the internal overflow sentinel; reader/memory/other failures propagate. Sixteen is a finite implementation bound, not a promise to fit arbitrary history. Fixed sixteen passes for every batch would add unnecessary work to empty/small batches; progressively doubling would add up to thirty-one scans to a heavy batch.
2. Assign each ranking key to exactly one partition using a stable 32-bit string hash. Every occurrence and distinct-dictation contribution for that key therefore stays together. Hash collisions share a partition; they never merge keys. Owner-selected text is neither logged nor sent elsewhere.
3. Each partition ranks all qualified entries locally, retains its best 100 and sums its qualified count. Merge those bounded candidates with the same total ordering and retain the global best 100. A global top-100 entry must be within its partition's top 100; omitted count equals total qualified entries minus returned entries. Count coverage and comparisons in partition zero only.
4. Keep fresh readers within the existing transaction. Every failed attempt clears intermediate maps. A partition overflow after the retry reports aggregate-capacity; the existing store transaction rolls back. Tests use synthetic collisions and the production boundary without changing resource budgets.

## Risks / Trade-offs

- More retained-store scans and string hashing → measure full synthetic store replay and native production CLI; retain 60-second and 512-MiB limits. Installed-history performance remains a separate qualification.
- Uneven hash distribution or sustained growth → keep visible bounded failure and last-good state; no silent truncation or deletion.
- Cross-partition ordering/support mistakes → hand-calculated ties/omitted/support cases and complete-output comparison to the previous implementation on fitting data.
- Partial retry counts → reset failed coverage and tables, count statistics once, and test fallback coverage and comparisons.

## Migration Plan

Release complete collector 1.1.4 with no wire/store/algorithm version change. Preserve installed 1.1.3, 1.1.2, config/namespace/state/backup and pause on qualification failure. After reviews, PR/main CI and exact package checks, stop at the owner's refreshed package/recovery checkpoint before selecting the replacement. Rollback uses a compatible preserved package; clearing or numeric-only rollback retains its separate documented fencing.
