## Context

See proposal.md for the installed failure and owner authority. The existing private store already owns transactional retained contributions and atomic publication. All supported tables are currently counted at once; the 250,000-key counter measures cumulative duplicated state across four periods and three corpora.

## Goals / Non-Goals

Reduce peak intermediate ranking state without changing output or storing another durable counter representation. Keep source scans, per-record analysis, private-store format, policy identities and sharing semantics unchanged. Incremental counts and source-reading changes remain separate work.

## Decisions

1. Process one preset/corpus batch at a time, retaining that batch's 28 app/category groups. This gives 12 bounded passes rather than 336 full store passes, preserving the existing four matching subgroup updates per contribution. After support/sort/cap, clear maps before the next batch. Preserve the original preset/app/category/corpus table order for consumers.
2. Replace one-shot retained input with an explicit repeatable reader factory, also permitting readonly arrays for pure fixtures. Store callers open a fresh generator for each pass inside the same existing transaction. This prevents exhausted iterators from silently producing incomplete later groups and avoids materializing all private features in memory. Existing periodic store memory checks remain active on every pass.
3. Reinterpret 250,000 as the number of active keys in one preset/corpus batch. This is an intentional documented resource-policy change, not a hidden increase of the memory/time limits. Keep a negative batch-capacity control, transaction rollback and bounded publication. Exact ranking semantics and algorithm identity are unchanged.
4. Preserve all output tables and their stable order. Finalized bounded results may remain in memory, subject to the existing memory and serialized-publication guards; temporary full ranking maps may not accumulate between batches.
5. Qualify with synthetic diverse text, exact baseline equivalence and native packaged operation. Raising the old global cap alone would retain its duplicated peak state. Persisted incremental counters require migration/recovery design and do not eliminate first-import/rebuild capacity. Processing each table separately requires many more private-store passes. These alternatives remain available if the chosen batch design does not fit measured budgets.

## Risks / Trade-offs

- Twelve retained-store passes increase read/parse work → measure elapsed time and peak RSS, keep existing run/source limits and stop on unsuccessful qualification.
- A single diverse batch can still reach the cap → preserve visible failure and last-good state; no history eviction or approximate ranking.
- Garbage collection may delay reclaiming cleared maps → retain the existing process memory guard and qualify actual native RSS rather than infer it from key counts.
- Repeated iteration could drift or exhaust → require a fresh factory inside the same private-store transaction and test repeatability and exact output.

## Migration Plan

Release a complete collector patch artifact with updated manifest/version. No store or wire migration is required. Retain old package, private config/namespace/state and managed numeric backup. Obtain fresh review/CI, then refresh replacement package identity and documented recovery before owner-approved installed resumption. Restore the old package/config if qualification fails; do not clear retained history to make the new package fit.

## Open Questions

Installed successful-language runtime and RSS are unmeasured. Synthetic/native qualification precedes source acceptance; live comparison, recurring task and one-day observations remain #472's installed finish line.
