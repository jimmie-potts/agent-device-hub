## Context

See proposal.md. #1006 supplies the operator capability, private immutable admission, command binding, atomic completion and one-shot browser transport. The existing owner operation acknowledges one consumer only. #922 owns the dashboard runtime feeds and Connections layout.

## Goals / Non-Goals

**Goals:** one operator action, one serialized all-consumer owner save, and evidence from the existing copies. Keep the selected notice and record revision stable through save.

**Non-Goals:** permission frameworks, durable schemas, retries, device membership management and physical-device acceptance.

## Decisions

Add `acknowledgeAll` beside consumer acknowledgment using the owner queue and configured consumers. Separate per-consumer saves would expose partial durable acknowledgment, so the new operation commits once. It independently refuses an older retained notice.

Reuse operator admission and `CoreStore.during` rather than create another dispatcher. Read and save-time guards check the current record and latest retained notice. A failed save rolls back acknowledgment and matching completion before projection; no-notice/already-acknowledged selections use the existing no-op completion transaction.

Reuse `sendAction` and #922's existing core operation copy. The standalone Connections component receives that copy and session/control facts; it opens an explicit keyboard-accessible confirmation and captures one immutable attempt. Transport acceptance remains separate from completion and the selected notice's synced acknowledgments.

## Risks / Trade-offs

A newer notice or maintenance may intervene after the read guard -> repeat the selected notice/revision guard inside the owner save transaction, and refuse without effects. A lost response or timed-out action -> show uncertainty and current copy evidence; never resend automatically. Restart may leave pending actions uncertain -> retain the existing tracker recovery semantics, then sync current state without replay.

Caller attribution and request/trace continuity use ADR 0012's existing tracker diagnostics. `forbidden`, `not-found`, `revision-conflict`, storage `capacity`/`internal`, and `uncertain-result` keep the existing shared error body and retry declarations; the browser always sends once. Successful observed evidence describes metadata acknowledgment only. No content collection or publication scope changes under ADR 0011.

## Migration Plan

No durable migration. Source-only delivery under #1009; install with the owner-present #840 cutover. The coordinator integrates the small Connections insertion with #922 before browser/Acceptance verification. Specification synchronization/archive follows successful Acceptance; independent source reviews and hosted CI are downstream delivery gates.
