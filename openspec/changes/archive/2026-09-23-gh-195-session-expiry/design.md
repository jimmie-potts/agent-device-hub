## Context

The owner kept every session record until capacity. At 128 records it rejected new identities, even when all retained sessions were days old. The owner chose on 2026-09-23 to forget sessions after 24 hours without genuine agent observations.

## Decisions

- **Clock.** Retention uses each session's `lastEvidenceAtMs`. The reducer sets it only when it applies lifecycle evidence. Duplicates, repeated starts of the same turn, labels, acknowledgments and read evidence do not change it. The value is persisted, so a restart keeps the window.
- **Boundary.** A session expires when `now - lastEvidenceAtMs >= 24 hours`. `LIMITS.sessionAgeMs` records the constant beside `journalAgeMs`.
- **Mechanism.** One `replace` commit removes all due sessions and prunes the journal, advancing the revision once. Both adapters already implement `replace`, and it needs no new storage operation or durable format. Expiry writes no journal row, because the journal's kinds describe lifecycle mutations. Expired sessions' own rows are already older than the journal window.
- **Timing.**
  - The maintenance timer fires at the earliest journal or session due time.
  - Startup runs maintenance before accepting work.
  - Every ingest expires due sessions first, so an event for an expired identity creates a fresh record and a full owner frees slots before any capacity rejection.
- **Admission.** A `runtime.ended` or `read.observed` for an unknown identity is stale. Any event whose `observedAtMs` is at or before the cutoff is stale. These rules stop old and end-only observations from refilling freed slots.
- **Children.** Each record expires on its own clock, with no cascade. Child counts are derived from records present, and consumers already present a child without its parent.

## Risks

Expiry deletes state by design, including open notices and attention. Recovery from a wrong expiry is new activity or restoring the private pre-install backup. Test fixtures that stamped events at tiny `observedAtMs` values against a real clock now read as ancient, so they use `Date.now()` like real producers.
