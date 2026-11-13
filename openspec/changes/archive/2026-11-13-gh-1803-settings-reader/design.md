## Context

The history route already admits ordinary read credentials and traces bounded
HTTP reads. The core owns the settings and records committed edits in its local
fact log. Current owner settings remain authoritative under ADR 0012 and ADR 0015.

## Decisions

- Use `settings=snapshot` with no additional query fields, or `settings=page`
  with required `after` and optional `through`. Keep the existing
  `history/2.0` schema and filtered history mode.
- Collect current owner state and the local head in one synchronous SQLite read
  transaction. Refuse an open write transaction or unavailable owner. Do not
  enter the general core sync path, which can update and publish session state.
- Carry `origin`, `after`, `through`, `next`, `applyThrough`, `done`
  and `facts` on a page. Each projected fact carries family, ID, origin sequence,
  outer transaction revision and time. Omit `through` on the first page, then
  keep the exact returned head for the pass. Use `next` only as the next
  `after`. A restart resumes from the durable checkpoint with `through`
  omitted. An anchor proves row identity. A change replaces entire selected
  top-level members. An eligible removal deletes the entity.
- Scan at most 63 raw rows per page. An empty projection still advances the
  scan cursor. Seal through the preceding revision when the page ends within
  a possibly unfinished revision. Reaching the fixed head seals the tail.
  A follower can buffer at most two settings facts from one unsealed revision.
  Each projected value is limited to 256 KiB and each answer to 16 MiB.
- Checkpoints carry the local origin, sequence and random row token. The
  existing origin/sequence index verifies both bounds in the same read.
  Every new local row receives a token in its original transaction, even
  when it has no message ID. The open migration adds one nullable column and
  marks an unanchored local tail as a legacy barrier. A fresh snapshot can
  begin there. Readers cannot advance across a barrier or unanchored row.
- Reuse fixed errors and the gateway's authenticated read trace. Malformed
  inputs return `invalid-request`. An origin mismatch returns `invalid-state`.
  Missing or changed anchors and legacy barriers return `revision-conflict`.
  The gateway checks the selected decoded payload with the live secret registry
  before returning it. Reads create no durable effects and have no retry loop.
- A core edit that would contribute a settings fact rolls back when SQLite
  ignores the fact insert or its latest-record update. Preserve the existing required Automation receipts
  and the handling of ignored unrelated rows.

## Failure and recovery

A failed migration rolls back with its enclosing transaction. Older inserts use
explicit column lists and can leave the new column null. On a later open, a
legacy tail receives a new barrier. If the follower sees a same-origin conflict,
it discards the pass and requests a complete snapshot, verifies the pinned
origin, and passes the latest durable expected checkpoint to the receiver for
replacement. A different origin requires explicit enrollment. The follower
owns transient retry and durable progress.

Sequence zero confirms the origin alone. A return from a writer that could
save covered settings without recording a detectable fact requires a fresh
snapshot before incremental resume, including from zero. That operational
prerequisite applies even if all stored row tokens match.
