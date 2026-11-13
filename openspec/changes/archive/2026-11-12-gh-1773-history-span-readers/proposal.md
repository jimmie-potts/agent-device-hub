## Why

Since #1772, history keeps repeated readings as spans: a change row carries the stretch it closes (`span`), a silence of a polled family is a gap row (`gapMs`), and a removal may be preceded by a closing row (`closedBy: 'removal'`). The open span of each entity lives in `core_history_span`, which no reader can see, and the Timeline shows every such row as an ordinary update ([#1773](https://github.com/jimmie-potts/agent-device-hub/issues/1773), design [#1768](https://github.com/jimmie-potts/agent-device-hub/issues/1768)).

## What Changes

- **History read** (`apps/runtime/src/core/history.ts`): `History.open(rows)` returns the open spans of the entities that have a change row in `rows`, one keyed lookup per distinct entity, and `History.page(filter)` returns the rows of `read` with them as the optional `open`. `read` and `after` are unchanged; open spans are not facts.
- **Gateway:** `GET /api/v2/history` answers `{schema: 'history/2.0', rows, open?}`. `open` is present only when an entity in the page has an open span, so other answers are byte for byte as before. Nothing validates the members of this answer; the dashboard's reader reads `rows` and now `open`.
- **MCP:** `core_history` reads the same page. Its closed published result schema requires `rows` and allows optional `open`.
- **Timeline** (`apps/runtime/dashboard/src/timeline-model.ts`, `timeline-read.ts`, `timeline-card.tsx`): change rows with a span, gap rows, closing rows and the newest row of an entity with a matching open span get plain lines under their context. The dedicated Timeline lists open spans with unknown starts by entity.
- **Unchanged:** filters, limits, refusals, the response's existing members, the history intake, the fact log, the read path's scan time (#1760).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shared-inbox-history`: "Read-only filtered history surfaces" gains the optional `open` member of the HTTP and MCP reads.
- `timeline-card`: "Concise truthful history" says what span, gap, closing and open-span rows show.

## Impact

`apps/runtime/src/core/history.ts`, `core.ts` and `gateway/gateway.ts`; the Timeline model, reader, card and CSS; runtime and dashboard tests and the Timeline browser journey; `apps/runtime/README.md`. The published MCP result schema changes. Storage and intake stay as before. Source only; installation is with #1774 or the batch after it.
