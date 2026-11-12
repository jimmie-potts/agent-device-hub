## Context

#1772 writes spans, gap rows and closing rows (`apps/runtime/src/core/history.ts`); the open span of each entity is in `core_history_span` with the revision of the row it was written against. The gateway's history route, the MCP tool `core_history` and the Timeline read rows only. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**
- A reader of the HTTP read gets the open spans of the entities in its page, at a bounded extra cost per page.
- The Timeline says what a span, a gap, a closing row and an open span hold, in plain short lines, and nothing it does not hold.
- Every answer and every row without these reads exactly as before.

**Non-Goals:**
- Changing the MCP tool's answer or output schema (an open decision of the owner on #1773); the read path's scan time and index (#1760); the noisy-entity alarm (#1778); installation (#1774).

## Decisions

- **`History.read` stays rows only; `History.page` adds `open`.** `read` has callers in the core, the MCP tool and tests; keeping it lets the MCP path do no span lookup and keeps every caller unchanged. `page` is `read` plus `open(rows)`. The issue's wording put `open` on `read`; the result for the HTTP reader is the same.
- **One keyed statement per distinct entity.** `open` collects `(source, family, id)` from the page's change rows and runs one statement for each: a join of `core_history_span` and `core_history_latest` on their primary keys. Other rows add nothing; a page of at most 500 rows makes at most 500 lookups, typically a few.
- **Served only when the write path would continue it.** The span must have been written against the entity's last row (`row_revision` equals the latest revision, and the last seen revision is not below it), and the latest record must not be a tombstone; otherwise the intake would reset it. It is served only when it holds more than its row's reading, the same rule by which a row carries `span`, so `open` is what the entity's next row would carry.
- **Optional member, present only when non-empty.** A page with no open span answers `{schema: 'history/2.0', rows}` exactly as before. Nothing validates this answer's members: there is no schema file for `history/2.0`, and the dashboard's reader checks only `rows`. So the member is additive for HTTP readers.
- **The MCP tool waits for a decision.** Its output schema is closed and published to clients (`additionalProperties: false`, embedded by `packages/mcp` as `data`); a client holding a listing from before an upgrade would refuse a result with `open`. The core's tool reads `Core.history`, rows only; `Core.historyPage` is the page. Returning spans over MCP would read `historyPage` in the tool's wiring and add `open` to the tool's output schema.
- **The Timeline attaches an open span to one row.** It is shown on the entity's newest change row in the page, only when that row is at the span's revision and, for a known start, at the span's start instant; an unknown start matches by revision. A later gap row at the same revision outside the page therefore never lends its span to an older row with a known start.
- **Lines, not new titles, except where the old title was wrong.** A change row with a span keeps its title and gets "After 4 h 29 min unchanged, 3,300 readings". A gap row is not an update of the state, so its title is "Readings resumed"; a closing row changes nothing, so its title is "Last readings before removal". Lines sit under the context in the closed row on the Timeline page; in a Home shape they show only when the entry is open, so the fixed row height that Home paging counts is unchanged.
- **Times as recorded.** Lengths are the difference of recorded instants; when they run backward no length is shown. Instants are written as the viewer's date and time of day. No line says "now".

## Risks / Trade-offs

- [An open span read at a different moment from the rows] → both are read in the same synchronous call on the core's connection, so no commit falls between them.
- [A row without its own `revision` in the record] → such a row never matches, and no open span is shown.
- [The Home card's closed rows] → lines are hidden there while closed; the dedicated page shows them.
