## Context

The tracker owns core_operations; its CorePart.tracked hook runs inside the authoritative CoreStore transaction. core_history already retains operation steps and participant messages. The dashboard and gateway supply the existing authenticated read/control surfaces. See proposal.md and Hub #923.

## Goals / Non-Goals

Keep one durable operation inbox and one retained history owner. Add no service, retry queue, paging, migration, graph or benchmark. Preserve the fixed profile/error registry, device holds and unread session notices.

## Decisions

- InboxRecords is a CorePart in the existing SQLite database. A handled row retains actor, handling instant and removal revision. Conflict reopens at the next core revision; other late outcomes leave handled rows alone. Open items retain late definitive evidence, including success, until handled. A 2.1 additive inbox schema adds that evidence and two opposite conflict outcomes; 2.0 remains registered.
- inbox-handle is a bounded direct core command. Dismiss commits handling and a deleted removal together. Send-again uses Tracker.dispatchFromInbox's private callback in the initial sent transaction, so removal and the fresh operation commit before sending. A failed admission or commit preserves the original; a crash after commit never resends and the new operation becomes uncertain. A second handling call cannot dispatch again. This avoids a split-commit gap without a general SDK transaction API.
- Gateway and MCP retain existing read/control admission. All readers see the whole inbox/history. Filters combine inclusive time, kind, source and qualified session. SQL uses bound values; reads publish nothing.
- RuntimeFeeds syncs the inbox from its core owner. Timeline reads on entry or explicit filter submission, with no polling. Controls use the current revision, fresh request IDs and no retry/replay. Accepted handling is distinct from synced removal and device completion.

## Risks / Trade-offs

- Large retained history answers use the existing API response path; paging is expressly deferred by #923. The one 1,000-item check records per-message and total sync bytes without adding a timing target.
- A responder refusal after the new sent commit produces its own failed inbox item. The original handling and new responsibility are durable together.
- History and operation data remain private in the existing owner store. Synthetic fixtures alone enter source or publication evidence; no collection scope or destination changes.

## Migration Plan

Fresh state/manual configuration is accepted. This delivery changes source only; #840 owns installation. No old-store transfer or migration is included.
