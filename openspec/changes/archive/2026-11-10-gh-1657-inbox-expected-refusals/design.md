## Context

The core's `InboxRecords.tracked` runs in every tracked operation's change transaction and opens an item for any result other than `succeeded`, except routine background art and gateway operator actions. Send again (`inbox-handle`) refuses some operations before handling them, and the dispatcher refuses others by requester when Send again resends as the handler. Nothing linked the two, so the Inbox kept items whose only possible handling was Dismiss.

## Goals / Non-Goals

**Goals:** open no item that only Dismiss could clear (D1, D3), keep every outcome in history, keep Send again's answers the same apart from stale mode revisions, and stop the assistant's own mode change from conflicting with a mode change the owner made just before approving it.

**Non-Goals:** expiry or clearing on a later success (D2), clearing items already open, new codes, message formats or error shapes, labels for raw target IDs.

## Decisions

- **One predicate.** `resendRefusal(operation, handler)` in `inbox.ts` returns Send again's refusal or nothing. Send again calls it with the handling command's source. `historyOnly(operation)` calls it with the dashboard's source, the handler with the widest resend authority, for a rejected operation only. The dispatcher's requester checks move unchanged into `requesterRefusal(family, requestedBy)` in `tracker.ts`, which both the dispatcher and the predicate call.
- **A refusal means a rejected reply.** Status `rejected` (result `failed`, evidence `none`) proves the owner refused the command before acting, so it holds nothing. An `expired` command, a failure after acceptance, an uncertain result and a conflict keep opening items: each may hide an effect or a fault a person should see.
- **Stale mode revisions are dismiss-only.** The Hub mode's revision is the core store's revision and only grows. A `mode-set` or `mode-override-set` refused `revision-conflict` with a saved `expectedRevision` can never be accepted again with that payload, so Send again refuses it up front with `revision-conflict`, and the open rule skips it. The dashboard's Hub mode and per-device mode controls send the record's revision too, so a choice made from a stale page is refused the same way; the page shows the refusal when it happens, and the owner chooses again from the current mode.
- **The assistant binds the revision at send time.** The approval names a mode. At the act step the engine reads its synced core copy and sends that revision. An admitted call is never sent again, so a replay after a restart needs no copy. With no synced copy it sends nothing and says so. A conflict that still happens says the mode changed just before sending and that nothing changed.

## Risks / Trade-offs

- An owner-triggered refusal that Send again could never repeat, such as a dashboard or MCP mode change with a stale revision, no longer appears in the Inbox. The caller still gets the refusal when it happens, and history keeps it. This is D1's stated effect.
- A future family whose resend is impossible but that the predicate does not name keeps opening items. That fails toward showing an item, not hiding one.

## Migration Plan

No schema, storage or contract change. Existing open items stay until handled. Send again on an existing stale mode-set item now returns `revision-conflict` and leaves the item for Dismiss. Rollback restores the earlier rule with no data change.
