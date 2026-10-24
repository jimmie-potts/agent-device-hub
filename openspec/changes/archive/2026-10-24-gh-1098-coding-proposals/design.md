## Context

See proposal.md. Design is included for the timing/privacy decisions in an otherwise module-local browser feature. The existing Reachy React page syncs companion state; the shell already holds authoritative core session/mode copies. Module scopes only sync their own catalog families; an additive optional SDK frontend-context field supplies those existing shell copies and their independent live flags without loosening that boundary or opening another subscription.

## Goals / Non-Goals

**Goals:** Useful manual preview with truthful owner attribution and conservative invalidation.
**Non-Goals:** Durable evidence ingestion or archival acceptance, automatic extraction, provider adapter, shared contract, speech or execution.

## Decisions

Use a browser-memory form on Reachy rather than another upload/store/command path. It is transient input and preview, not retained collection; no backend receives it. Each fixed check has one status and plain reference. Require a task, current full head SHA, matching evidence head, nonfuture observation within five minutes and a reference for each claimed passed/failed/skipped check. Optional base/repository stay unknown. Supported templates prioritize investigating a failed check, then unrun build/browser/accessibility after passed tests; otherwise show a gap. No command text is inferred from arbitrary references.

Bind inspection to the exact synced session identity/generation/revision/turn and current form. Changing task/session/repository/revisions clears prior checks; any edit retires preview. Compare observation times within the same task/session to reject older replacement. Repeated exact inspection preserves the existing proposal. Reconnect discards all evidence and never inspects automatically. A timer expires the display; Copy also performs synchronous final validation, including after policy/source changes.

Reachy settings are current only after successful companion-copy sync. The SDK's additive per-copy `onRestarted` callback, passed through the scoped frontend API, invalidates readiness immediately on overflow even while transport stays connected. Only replacement `synced` restores it; an early update or a late initial-sync promise cannot restore retained settings. This callback changes no wire payload, subscription, ownership or diagnostic contract. Its exceptions are reported without interrupting recovery, and the shell stops delivering it after the module scope closes.

Overflow during snapshot notification preserves every already-applied entity notification, as the existing SDK contract requires. Only the interrupted snapshot's completion is suppressed, so callback-maintained projections catch up before a current replacement sync marks them live. Initial sync settlement waits for that replacement too.

Extract ordinary browser-safe module-local enablement/mute/availability and freshness guards from existing rules, retaining the backend behavior. Manual suggestions use coding-notice policy, attention precedence and known core mode, without inventing a turn-ended occurrence or consuming social/reaction slots. Output uses existing Facts/Badge presentation. No cross-owner task-evidence data exists, so no new versioned payload is needed. The additive browser-only context API carries core metadata already admitted to the shell, never task evidence; absent/unsynced copies refuse previews. Existing authenticated SDK sync carries its current 2.0 envelopes, codes, trace continuity and diagnostic records unchanged. Local form refusals are inspectable text, with no new logs/payload capture. Clipboard exceptions map once to static local feedback; no retries, commands or uncertain durable effects.

## Risks / Trade-offs

- Owner-entered check claims may be wrong → label them explicitly; no verification claim or automatic execution.
- Git revisions are unavailable from lifecycle metadata → require owner-declared current/evidence heads; never claim automatic repository validation.
- Conservative exact session revision invalidation can suppress still-relevant advice → ask for a fresh explicit inspection, without guessing identity.
- Drafts are lost on reload/disconnect → explain transient input, retaining no server data or fabricated recovery. Durable input is deferred until an actual selected producer (#502/#425) needs it.
- No provider is configured → exercise unavailable input/output and clipboard boundaries directly; no speculative fake provider framework.

## Migration Plan

No database or wire migration. Source-only optional page addition with existing controls. Normal revert restores the old page; installation remains separately selected under #643.
