## Context

#1772 writes spans, gap rows and closing rows (`apps/runtime/src/core/history.ts`); the open span of each entity is in `core_history_span` with the revision of the row it was written against. The gateway's history route, the MCP tool `core_history` and the Timeline read rows only. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**
- An HTTP or MCP reader gets the open spans of the entities in its page, with one keyed lookup per distinct entity represented by a change row.
- The Timeline says what a span, a gap, a closing row and an open span hold, in plain short lines, and nothing it does not hold.
- Every answer and every row without these reads exactly as before.

**Non-Goals:**
- The read path's scan time and index (#1760); the noisy-entity alarm (#1778); installation (#1774).

## Decisions

- **`History.read` stays rows only; `History.page` adds `open`.** The in-process rows-only callers keep `read`. HTTP and MCP use `page`, which is `read` plus `open(rows)`.
- **One keyed statement per distinct entity.** `open` collects `(source, family, id)` from the page's change rows and runs one statement for each: a join of `core_history_span` and `core_history_latest` on their primary keys. Other rows add no lookups. An explicit limit caps rows at 500. With the limit omitted, the page contains every matching row and still uses one lookup per distinct change entity.
- **Served only when the write path would continue it.** The span must have been written against the entity's last row (`row_revision` equals the latest revision, and the last seen revision is not below it), and the latest record must not be a tombstone; otherwise the intake would reset it. It is served only when it holds more than its row's reading, the same rule by which a row carries `span`, so `open` is what the entity's next row would carry.
- **Optional member, present only when non-empty.** A page with no open span answers `{schema: 'history/2.0', rows}` exactly as before. Nothing validates this answer's members: there is no schema file for `history/2.0`, and the dashboard's reader checks only `rows`. So the member is additive for HTTP readers.
- **MCP uses the same page.** The owner selected optional `open` for `core_history`. Its closed result schema still requires `rows`. Clients with cached tool definitions may need to list tools again after an upgrade.
- **Timeline annotations match the recorded start.** A known span can appear on the entity's newest change row in the page when both its revision and start instant match. An unknown start cannot identify an opening row. The dedicated Timeline shows its label, family, last recorded reading and count in a separate group for entities in the loaded entries and selected category.
- **Lines, not new titles, except where the old title was wrong.** A change row with a span keeps its title and gets "After 4 h 29 min unchanged, 3,300 readings". A gap row is not an update of the state, so its title is "Readings resumed". It shows the preceding span’s "After …" line when present. A closing row changes nothing, so its title is "Last readings before removal". Lines sit under the context in the closed row on the Timeline page; in a Home shape they show only when the entry is open, so the fixed row height that Home paging counts is unchanged.
- **Times as recorded.** Lengths are the difference of recorded instants. An open span with backward times shows both recorded instants and explains their order without a duration. Instants are written as the viewer's date and time of day. No line says "now".

## Risks / Trade-offs

- [An open span read at a different moment from the rows] → both are read in the same synchronous call on the core's connection, so no commit falls between them.
- [A row without its own `revision` in the record] → such a row cannot match a known start.
- [The Home card's closed rows] → lines are hidden there while closed; the dedicated page shows them.
