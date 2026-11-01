## Context

See proposal.md for the issue and motivation. The manual Desktop test established one real accepted action on Desktop 26.1027.30824, build 22943, with bundled app-server 0.166.0-alpha.5.1. It did not qualify an installed producer. Same-process subscriptions carry read changes without reader identity. The runtime admits only Claude's owned-UI receipts and its store currently requires the owned-UI revision. The existing provider-client contract already carries native seen/accepted revisions and a frozen owner target.

This design is required because the change crosses native transport, credential admission and the state owner, and must preserve native behavior on collection failures.

## Goals / Non-Goals

Use the selected Desktop connection as the observation point. Reuse the lifecycle feed, SDK, core transaction and receipt schemas. Keep Claude's stricter displayed-record revision check unchanged.

Do not create another state owner, provider update request, Hub polling loop, generic transport framework or native database reader. Do not extend this delivery to other Desktop versions, CLI readership, titles, archive state, explicit unread synchronization or device commands. Explicit unread cancels pending read evidence; it does not become a new lifecycle producer in this delivery.

## Decisions

### Observe one controlled native connection

An explicit host launcher checks the selected Desktop/app-server versions and supplies the observer executable only to that app process. The observer delegates all native CLI operations; collection applies only to a qualified Desktop app-server connection. Qualification comes from this enrolled integration and its distinct credential, not a caller's payload or an inherited originator string alone. Retain the existing normal startup path. If the existing app instance prevents a controlled launch, do not claim enrollment; coordinate an operator restart.

Shared state notifications were rejected as the primary signal because another client produces the same shape. A separate app-server snapshot process was also rejected because it cannot prove the action or its reader. The prototype's launcher controls are version-bound implementation controls, not a vendor stability promise.

### Separate native forwarding from observation

The native process starts independently of SDK readiness. Forward stdin/stdout/stderr without inserting protocol messages or modifying permissions. A bounded complete-line observer parses only allowlisted messages and response fields. Oversized frames, ambiguous IDs or observer faults disable collection while forwarding continues. Publication is asynchronous and bounded; no network or diagnostic write waits in the forwarding path. Native process exit closes observation and the SDK connection.

### Freeze the exact target before forwarding the read request

Keep bounded metadata correlation for native read snapshots and latest-turn selections. Require a nonempty unread state, its matching revision, and a completed latest native turn selected after that snapshot. At the read request, copy the already-synchronized B.U.N.N.Y. record only if full feed/session identity, native turn, root status, activity and finished notice agree. Do not wait for a missing owner record or select one when the response eventually arrives.

Only a matching successful response with read state cleared and a distinct accepted revision completes the observation. Errors, explicit unread, a newer turn, expiry, disconnect or lost SDK freshness discard pending evidence. A fresh SDK sync may enable future actions but cannot replay an action from the gap. The receipt records the original request-time target and actual observation time.

### Reuse provider-client receipt admission and persistence

Derive a dedicated Codex receipt source from the unchanged lifecycle feed and the qualified version tuple. Enroll it with only read and ingest. Gateways admit that source only for provider-client receipts belonging to its feed; ordinary hooks and the Claude source cannot publish them. Preserve all existing schema versions.

The core retains its common eligibility checks and selects the additional check by receipt kind. Claude retains its exact view-revision equality. Codex uses the native accepted-action identity and frozen generation/turn/notice. Derive a stable message ID from the qualified source, target and native revisions so the existing taken-message table rejects retransmission across restart. Repeated accepted provenance also makes no new transition. No database table or migration is needed. A receipt never asserts that an absent future observation was read.

### Keep errors and evidence within existing contracts

Use existing shared error and diagnostic conventions, with no raw protocol logging. Retain the accepted occurrence and session provenance through existing core history/outbox. Private qualification evidence stays outside Git. Native prompt/reply fields, tokens, transcript paths and unrelated messages never enter B.U.N.N.Y. payloads or diagnostics. Collection loss remains a gap rather than a fabricated successful receipt.

## Risks / Trade-offs

- Version-bound launcher controls can change. Verify versions at startup and leave an unsupported version unqualified; preserve native startup and document the tested tuple.
- A passive connection can miss an action during startup or outage. Require fresh native and owner evidence; do not retry or infer that the action happened later.
- A native completed reply may precede its lifecycle hook. Refuse the missing mapping and wait for a future explicit view action, rather than binding after the original action.
- An app-server proxy is part of the native I/O path. Test byte preservation, fragmentation, saturation, unavailable SDK and observer faults with real child processes; keep collection isolated from forwarding.
- Source tests cannot establish installed readership. Preserve the manual actual-client evidence and repeat the enabled path against the installed runtime after review and deployment.

## Migration Plan

Ship the collector, source admission, core branch and guides together through a reviewed PR. Synchronize these capability deltas and archive before final review. No contract or storage migration is selected. After merged-main CI, coordinate the established installation writer, prepare the exact upgrade and backup, install the reviewed runtime and host artifacts, then enroll the dedicated producer. The operator uses the controlled Desktop launcher for actual-client acceptance. Removing that launch selection or disabling the producer stops future collection without erasing committed evidence. Preserve previous releases and private state; do not infer recovery compatibility or restore a snapshot as part of this change.
