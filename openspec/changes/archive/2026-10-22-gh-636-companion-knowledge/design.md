## Context

See proposal.md. Significant persistent/private data changes require design under the schema. Existing preference snapshots, staged inputs and outbox transactions already cover the required lifecycle. Assistant messages have stable IDs and creation sequences but no meaning/audience metadata.

## Goals / Non-Goals

Keep one database, one owner, existing synthetic controls and versioned preference documents. Extend private reads; do not inject context into the graph, add an exporter destination or start devices.

## Decisions

- Reuse the preference entry implementation with a fixed knowledge namespace and separate outward document schemas. A second lifecycle implementation would drift; no configurable store framework is needed.
- Extend existing assistant message rows with private attributed records and keep the legacy page compatible. Migrate existing rows transactionally; preserve message/conversation IDs, sequence/time and text, with unknown audience/meaning where not observed. Task/checkpoint/tool evidence is operational and is excluded from new authoritative conversation/context reads.
- Conversation metadata records explicit participants, authority and epoch. Each conversation has immutable creation sequence. Shared Reachy–Duck fixtures have one conversation with both participants. Local messages append within that authority/epoch; unrelated imports cannot invent a common order.
- Corrections replace current meaning and increment revision without reordering. Deletion removes authoritative text and saves only ID/order/removal metadata. Current exports carry removals; import applies removals first, preserves existing corrections and refuses incompatible identity/order. Refuse any edit/removal affecting an unfinished task; operational checkpoints are not rewritten or claimed erased.
- Add one private knowledge management page with curated persona inspection, explicit context preview/copy, message selection/correction/removal and private import/export. Read grants allow inspection; control grants and fresh revision are required for writes.
- Reuse assistant-state metadata invalidation and assistant-input staging with a separate knowledge target. The existing assistant revision advances for content changes, so both legacy task and new content pages refresh through sync. Current context includes preference revision too. No new event family or diagnostic fields are necessary.
- Bound titles/text/history as preferences do (200/4096 bytes, 8 MiB retained entries), messages at 8 KiB, pages at 16 messages/64 KiB, context at 64 KiB, whole private archive at 8 MiB and uploads at 10 MiB. Overflow refuses atomically; it never drops retained history. Explicit context selections are at most 16 message IDs. Full archive validation precedes one outbox transaction.
- Curated profiles fix persona/output rules, with an optional explicit voice reference stored independently. No selected voice is fabricated. Duck audio qualification is a fake fixture contract only; no audio output route is added.

## Risks / Trade-offs

- Old standalone exports cannot know later removals → recovery instructions require a current export for deletion-safe fresh recovery; known local removals always win.
- Operational task evidence can retain deleted text → authoritative reads never fall back to checkpoints/calls; no secure-erasure claim.
- A full retained store cannot accept more history → explicit capacity refusal, current reads/export remain available.
- Imported provenance is supplied by a file → label it as imported and never treat it as observed household evidence or permission.
- Publication can fail after commit → retain existing outbox semantics and avoid automatic resend; state, revision, receipt and outcome commit together.

## Migration Plan

Source only. Add schema fields/tables on the existing SDK connection, convert legacy authoritative message rows without invoking the graph, and verify rollback/restart with actual SQLite. No installed migration is run. A later qualified runtime upgrade owns backup/admission. Source recovery uses a current versioned export into a disposable store; additive import does not replace current state.
