## Context

See proposal.md for motivation and Hub #1182 for acceptance. A design is needed for the asynchronous relationship between mode-save completion, independent device operations and persistent Inbox entries. The core already supplies all records; the presentation must not infer success from a reply or an unrelated record.

## Goals / Non-Goals

Extract presentation and retain the current adapters and shell connection. No backend, protocol, persistence, participant, diagnostic or tracing changes. The approved removals affect the card face, while detailed failure evidence remains in Inbox and Timeline.

## Decisions

Use pure HubModeCard, InboxCard and InboxItemCard presentation with state/callback props. Keep request/refusal/pending state in the existing HubMode/InboxPanel adapters. The shell supplies mode, operations, Inbox and device copies plus their sync state. Native disclosure keeps entry state and focus; a Check Inbox callback locates its summary without issuing a command. Do not add a global state library or second subscription.

Derive issue correlation using exact mode parent identity and the existing deterministic child identity for each target. Compare current related Inbox items against later completed successful selections and their affected device outcomes. Accepted, missing or conflicting child evidence cannot resolve an issue. A successful request for a target can stop the mode warning while its historical Inbox item remains. Compute only from supplied records, retain the prior projection during a stale copy and discard obsolete asynchronous projections. Local refusals use concise honest exception text rather than a fictitious Inbox link.

Keep mode selection behind current revision and authority checks with a synchronous in-flight guard. Inbox actions use the current item revision and guard duplicate submissions; uncertain or accepted handling waits for authoritative removal/revision before another action. Rendering, expansion, warning navigation, resync and reconnect never send effects. Requests use sendAction, retaining existing codes, trace context and diagnostics under ADR 0012. Presentation adds no log capture or producer.

Use existing skin semantic colors and shared geometry; only the small Hub indicator receives warning styling. Inbox may retain the approved attention surface. Match mode artwork across hero and buttons with one local icon component. Accessible live feedback stays concise and routine mode text is visually hidden. Retain visible stale/read-only/unknown exceptions.

## Risks / Trade-offs

- Missing or retired parent/child evidence → do not manufacture success; a current unhandled correlated item retains review status, with stale projection held until a full sync.
- Late conflict or reversed asynchronous projections → current copies and identity-bound computation win; test the transition and cancellation path.
- Shared item handled elsewhere → removal drives indicator clearing, without a local timeout or guessed success.
- Reusable presentation losing focus → use stable keyed native disclosures and explicitly test keyboard navigation to the target.

## Migration Plan

No stored-data migration. Validate in synthetic disposable runs, independently review one committed head and merge after applicable CI. Build an exact merged release and use the qualified established-runtime upgrade with held lock, stopped-writer backup, identity/health and passive state/client readback. Retain latest durable state and receipts; no automatic snapshot restore or unqualified older-release recovery. No physical commands are selected.

## Retired operation evidence

The operation family retains only 256 recent settled copies; Inbox items remain until handled. A fresh view cannot reconstruct every historical Hub parent from those copies. The adapter therefore keeps retained native device-mode items reviewable when their association is unavailable, with an explicit explanation in the corner control and accessible feedback. A current independent requestedBy excludes its native item; absent evidence cannot do so. No request-ID prefix is treated as origin proof. Clearing the unavailable association requires handling or a later successful Hub request with its exact successful core child for that target, sent after item creation. This may conservatively surface an old independent native-mode issue after its identifying copy retires. It does not label that association as a proven Hub selection and adds no acquisition, persistence, contract or backend path.
