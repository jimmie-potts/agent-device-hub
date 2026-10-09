## Context

See proposal.md for motivation. The core has a durable outbox and one tracked dispatcher. Nanoleaf has one locked writer per device, a control journal, effect recipes and a SceneRestorer. The old Hub arbitration and private automation tables remain reusable source; they are not a storage migration.

## Goals / Non-Goals

Expose core controls with the existing rule/settings shapes and keep device execution in Nanoleaf's writer. Frontend and authenticated gateway integration belong to the coordinating writer. No alternate scheduler or direct device sender is added.

## Decisions

Copy the existing rule engine and table definitions with provenance, adapting only dispatch evidence and clock semantics. A core post-commit notification marks which occurrence IDs are new in this run; the bus subscription evaluates only those IDs on the first attempt of the original publication batch. Failed publication and the end of that batch discard unused marks; a gap discards marks instead of replaying them. Sync and outbox replay cannot acquire that mark. Persist deduplication before evaluation. This avoids deriving liveness from timestamps or restarting a queued rule after a crash.

Use the dispatcher for each target and retain its request ID in the private log. Project the current operation separately from the admission receipt; do not turn acceptance into completion or retry uncertainty.

Admit bounded Lines moments into the existing control journal. Preflight Free content through reads before admission, recheck it in the writer, and reuse curated effects through the same Execution journal. Work restoration is recomputed from current state; named Free restoration is allowed only while no newer content choice has taken precedence. Mode changes retire the journal row, and interrupted writes use the existing hold policy.

## Risks / Trade-offs

- Device observations can change after admission → recheck before effects and before restoration; never restore an obsolete choice.
- An answer may be lost → existing Execution records the attempt first and holds uncertainty without resending.
- A crash after dispatch but before logging → dispatcher history remains authoritative and the occurrence is already consumed; no retry.

## Migration Plan

Deploy fresh core automation tables with no transfer of legacy rules or settings. Legacy Hub behavior remains available until the separately selected cutover. Source and simulator validation do not authorize installation or physical tests.
