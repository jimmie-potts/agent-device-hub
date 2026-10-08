## Context

See proposal.md for motivation and the capability deltas for behavior. This design is required by the schema because admission, concurrency and the owner save cross the gateway, tracker and core store. The coordinator accepted these internal interfaces for #1006. The existing tracker sends commands as `bunny/core` and excludes core messages from its intake; the agent-state owner writes through the store's existing outbox transaction.

## Goals / Non-Goals

Keep operator admission explicit and make the label and tracked completion one durable fact. Preserve both SDK transports, existing public grants, agent-state rules and the signatures of `CorePart.tracked` and `CoreTransaction`.

The trust boundary is authenticated external admission versus ordinary module/SDK dispatch. Trusted code inside the core owner already has its SDK and database; this change adds no adversarial plugin isolation, SDK extension, participant or wire authority flag. #372 self-labeling and #1009 all-consumer notice clearing are separate work.

## Decisions

1. Add `CoreModule.operatorActions` for runtime composition to pass only to `GatewayOptions.operatorActions`. Keep ordinary `CoreHandle.dispatch` and module actions unable to admit operator-only families. Recheck existing control authority and credential liveness at dispatch; derive audit attribution from the principal. A JSON flag or moving labels into `DIRECT_COMMANDS` would bypass the required tracked boundary.
2. Let the tracker freeze command facts before its first await and install a private admission only for a newly inserted action, before sending. Match authenticated core source, operation identity, key, schema, target, canonical payload and request ID; bind the first responder's actual command ID. Copied IDs cannot consume the context. An object-identity map alone would fail across remote serialization. SDK settlement removes a waiting admission; an admitted running command retains it until its responder finally ends, allowing late durable completion. Duplicates never replace the entry.
3. Dispatch outside the core's mutation queue. The responder admits before waiting on that queue; otherwise dispatch could wait for a responder queued behind itself. Check the current session and its guard at the owner mutation boundary. A deterministic test queues maintenance before the label to verify that an intervening owner revision cannot pass the guard.
4. Extend `CoreStore.during` with an optional completion callback for only its matching cause. Invoke it inside the existing owner save/outbox transaction, after preparing records and before history/revision commit. The tracker adds the validated outcome, advances and writes the operation, and invokes the unchanged tracked hooks there. No second history record is added for the same outcome. Run postcommit diagnostics/scheduling only after success. Unmatched maintenance and refresh do not complete the action.
5. Short-circuit an already-clear or same user label and complete it through the store transaction without a session save or invented session revision. A matching agent label still changes its provenance to user. The owner's existing label rules and fault/reopen path remain authoritative.
6. The dashboard editor reads the explicit label separately from the displayed title fallback. It uses one request identity per explicit attempt, the synced revision and the authenticated generic action route. Record evidence must match the submitted value and current session generation; conflict preserves the draft. Stream recovery never retries writes.

## Risks / Trade-offs

- Owner maintenance has its own queue → assert the expected revision at the actual save boundary, with a deterministic intervening-maintenance regression.
- Save, tracked hooks or outcome validation can fail → exercise each failure and SQLite capacity failure; assert atomic rollback and owner recovery.
- Transport timeout can precede owner completion → retain the bound running admission until responder cleanup and verify the uncertain-to-completed transition.
- Commit can precede publication → retain the existing outbox and restart rules; verify state and operation remain committed without command resend.
- Shared files also host later operation records → keep their tracked transaction interfaces unchanged and coordinate integration through the owning writer.

## Migration Plan

This is an additive source change with no new store schema or public authority. Existing user labels need no migration. Install only during the separately owned #840 cutover. Source rollback follows the normal PR/runtime version rollback procedure; do not change the installed owner or its data during this work.
