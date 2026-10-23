## Context

See proposal.md. The Home catalog already mounts module browser exports. Companions supplies authenticated conversation-scoped latest/history reads, a single SDK SQLite connection, revision invalidations and tracked opaque-input controls. Design is required because the change crosses the shell/module boundary and adds a persisted selection.

## Goals / Non-Goals

Preserve conversation isolation and make a single selected exchange easy to read. No global latest-message reduction, private transcript copy, automatic selection, model call or output command is needed.

## Decisions

- Companions stores one nullable conversation ID in a singleton `companion_widget` row. Selection uses `select-duck-conversation` through existing knowledge staging and CAS/outbox handling. It validates a conversation containing both Reachy and MicroDuck, and can be cleared. Creation/import does not select anything; archive import leaves local selection unchanged. A fresh store starts unselected.
- `duck-widget/1.0` returns revision, selected conversation or null, messages and next cursor. The default returns at most one latest Duck message; `view=history&after=<sequence>` delegates to the same bounded record reader. Read as Reachy, so unrelated private Duck messages are never promoted. Selection is revalidated on reads. All errors retain the shared registry body, and queries carry only view/cursor, not conversation content or identifiers.
- Selection lives on Companion knowledge. Home's read-only card and a separate read-only conversation page share message presentation with the existing management history. Both clearly label the selected conversation. The module remains the only archive; no new SDK family or framework is introduced.
- Subscribe to assistant-state invalidations via the existing module scope. Retire rendered messages immediately on a new revision, disconnection or failed read; accept only the current request's response at or above the observed revision. Manual refresh is available after a read failure. No polling or automatic effect retry. The history page replaces each bounded page rather than accumulating an unbounded browser archive.
- Delivery references are opaque evidence references, not playback results. With no qualified audio result producer, show playback unknown; synthetic dialogue is explicitly labelled fiction. No timestamp is treated as current perception.

## Risks / Trade-offs

- A selected conversation can have no remaining Duck message → retain selection and show empty, with history still available.
- Concurrent selection/correction can invalidate a pending read → revision/request fencing hides the previous content and prevents stale completion from restoring it.
- A lost selection reply → existing command UI reports uncertain and does not retry; current owner state resolves the display.
- Access loss/offline → hide private content and show unavailable/stale state rather than retain a browser copy whose current permission is unknown.
- No qualified playback-state source → disclose unknown instead of mapping a delivery reference to heard/played/interrupted.

## Migration Plan

Create an additive singleton selection table on the existing connection. Existing histories and archive formats remain unchanged. Selection survives restart; fresh recovery requires explicit reselection. Source acceptance uses disposable synthetic state only. No installed migration, rollout or physical trial is selected.

## Boundaries and evidence

ADR 0012 command/outcome semantics and the diagnostic contract remain at the existing gateway, SDK and knowledge boundaries. Selection succeeds only when stored; read failures are safe fixed codes with no effect. Existing tracing follows the tracked request; no message prose or new browser logging is added. Tests cover revision conflict, wrong/private conversation, duplicate/restart, correction/removal, access loss, stale delayed reads and zero output effects. Browser checks cover Home placement, labelled selection, history navigation, keyboard, narrow layout and accessibility.
