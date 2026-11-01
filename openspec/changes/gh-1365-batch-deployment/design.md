## Context

The Mac container operator already verifies project/service ownership, private named volumes, stopped PID zero and consistent backups. Image replacement is manual. The schema requires design because this adds writer exclusion and an interruption-sensitive operational record.

## Goals / Non-Goals

Keep one active operation per selected project, preserve the latest state, and make each effect reviewable. No daemon, automatic retry, automatic rollback, snapshot restore, credential discovery or device test is introduced.

## Decisions

Use a host-private per-project lock and durable pending marker shared by deployment and manual start/stop/backup/restore entrypoints. Status remains read-only. A lock records the local PID and host. A stale lock is not automatically released. Explicit reconciliation first proves its recorded process has exited, inspects the exact selected container, and records that observation before releasing anything. A live or unidentifiable process refuses reconciliation.

Use one synchronized private record per deployment with the pinned previous/target image and revision, included issue links, owner, storage assessment, recovery eligibility, backup and phases. Write each phase before its corresponding effect. Failure retains the pending marker and latest state. After a failed start/check, stop only the exact newly created container and verify PID zero where possible. An ambiguous Docker result stays uncertain. No automatic second image replacement is attempted.

Download the selected Actions artifact only after checking its repository, fixed qualification workflow, exact candidate, run attempt and successful result. Validate its qualification receipt and archive hash through the shared qualification module, then inspect the loaded image's immutable ID/revision/ARM64 architecture. A local JSON assertion alone is insufficient authority.

Render the existing selected Compose configuration once, pin its hash and preserve its service settings. Override only the production image and use the existing exact private volumes and network as external resources. Verify the baseline container again under the lock before stopping, back up with its exact image, remove only its stopped ID without volumes, create the pinned replacement and compare preserved identity before starting. Compose drift or extra services refuse before stop.

Client verification is a fixed read-only browser sign-in/context probe against the selected container, never a command supplied in a request. Additional affected qualified clients retain separately named evidence in the deployment record and coordinator acceptance. The operator does not select personal profiles.

Previous-image return is explicit. It requires a fresh compatibility receipt bound to the latest stopped backup content hash, configuration hash and previous image/revision. Unknown or mismatched eligibility refuses without touching state. Compatibility is demonstrated against a copy of newly written synthetic state; it is never inferred from source ancestry.

## Risks / Trade-offs

A process can die after an effect but before its receipt. The pending phase records intent rather than falsely claiming completion; reconciliation observes reality and does not resume effects. Manual Docker commands outside the operator cannot be made cooperative by a filesystem lock; the operator guide requires the same exclusion window and prohibits bypass. Host-private files are owner-controlled operational inputs, not protection against malicious owner code.

## Migration Plan

Merge under the current gates, then let the designated coordinator qualify and select a bounded batch. Preserve the previous image, stopped backup and latest volumes. No service restart accompanies documentation alone. Installation, real-client evidence and physical acceptance remain separate from source tests.
