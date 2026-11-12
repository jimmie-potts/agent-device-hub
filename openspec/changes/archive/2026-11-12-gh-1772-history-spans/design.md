## Context

History writes each state as a change event against the record it holds in `core_history_latest`, which every state message rewrites (`apps/runtime/src/core/history.ts`). #1771 added each family's bookkeeping members and `sameState`, which ignores their values but not their presence or null-ness. The owner's decisions on #1768 fix the rules; this design fixes how the store keeps them. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**
- No row for a reading that changes only bookkeeping values; a span with its start, last confirmation and count instead.
- A row for every real change, with every member that differs from the last row, so a record rebuilt from rows equals the published record at each change and gap row.
- A gap row only for families published on a poll, after four polling intervals and at least two minutes.
- A store the previous release can still open and write, and a forward start after it that loses nothing.

**Non-Goals:**
- Presenting spans and gaps in the read API, the MCP tool and the Timeline (#1773); the noisy-entity alarm (#1778); compaction of stored rows (decision 5); installation and the re-measurement (#1774).

## Decisions

- **Spans outside the log.** `core_history_span` holds one row per entity: the last revision, message ID and type a reading carried, when the stretch started, when it was last confirmed and how many readings history took in it. It is updated in the intake's own transaction, so a crash loses it only with the uncommitted group. Rows stay append-only and `after` never reads the span table. Alternative: updating the last row's record; rejected, because rows are never updated and a peer reads rows only (ADR 0015).
- **`core_history_latest` unchanged in shape.** Its five columns stay, because the previous release inserts into it by position; it now holds the record of the entity's last row and that row's revision. A confirmation does not touch it.
- **The span opens at its row.** A change or gap row opens a span with that reading as its first confirmation. A row carries `span` only when the stretch it closes holds more than that one reading, so rows of families that never repeat a reading, such as agent sessions, are as before.
- **Gap rows only on confirmations.** A gap row is a confirmation of a polled family whose silence since the last confirmation is longer than the gap; it carries the moved bookkeeping values, `gapMs` and the span it closes, and opens a new span. A real change after a silence is a change row as always, without `gapMs`. The gap is `max(120000, 4 × interval)` for the `(source, family)` the registration declares; any other family has none.
- **Polling declared on the registration.** `ModuleFactory.polling` maps a family to the module's longest polling interval. A family may be one the module's `schemas` register or a contracts-package state family, such as `device`, which several modules publish at different intervals; history keys it by the module's source. The runtime refuses an unknown family or an interval outside 1 ms to one hour, as it refuses bookkeeping declarations. A checked-in table lists every registered module, so a module that starts polling, stops or changes its interval fails until the table matches. Each declared value is the module's own constant (`POLL_MS`, `PROBE_MS`, `IDLE_POLL_MS`), so a changed constant changes the declaration.
- **Closing a span before a removal.** When the open span holds confirmations beyond its row, a change row with no changed member and `closedBy: 'removal'` comes before the removal row. It carries the last row's revision as `revision` and `previous` and no message ID, so it claims nothing newer than its values (review of PR #1790), with the last confirmation's time and count in `span` and its type as the row's type. That is why the span table also keeps the last message's type, beside the columns the issue lists. A resend of the last confirmation after the removal is stale against the tombstone.
- **A release without spans in between.** The previous release rewrites `core_history_latest` on every reading and writes a row for each. Each span row keeps the revision of the last row it was written against (`row_revision`, nullable, in the table this change adds); this release moves `core_history_latest` only together with the span. A span whose kept revision differs from the latest table's is treated as reset: an unknown start (`sinceAtMs` null) and no confirmation yet. That covers both a previous-release reading past the span and a row at the span's own revision, and keeps the span of an entity that release took no reading of. A publisher that repeats one revision keeps its span (review of PR #1790; the first version compared the seen revision and reset such spans). The first change row after a reset carries the span from the unknown start. No gap is measured from a reset span.
- **The clock stepping back.** The span keeps the later of its last confirmation and the new one, so the next silence is never overstated.
- **A reused message ID.** A state under the last confirmation's message ID is dropped as a resend only when it holds the same state; with another state it is a change row. A state whose ID has a row is dropped as before.

## Risks / Trade-offs

- [A wrong bookkeeping entry hides a change] → #1771's rules and the leaf-mutation check, now run through the real intake for every family's fixtures.
- [A previous release that writes a row at the revision of the span's own row, with no reading past it] → not detected; the span then also counts across that row. It needs a republish of the row's own revision while that release runs.
- [A closing row does not hold the last confirmation's bookkeeping values] → it claims the last row's revision, whose values it holds exactly; the confirmation's time is in `span`.
- [History no longer says when each repeated reading arrived] → accepted by the owner (decision 2); the count is of readings history took.

## Migration Plan

At its next open the core store creates `core_history_span` empty, in the transaction that opens history. Nothing else changes: no column, row or index of another table, and no scan of history. A store opened again changes nothing. The previous release ignores the new table and writes as before; this release resets the spans it left stale. Rolling back is running the previous release; the table it ignores stays.
