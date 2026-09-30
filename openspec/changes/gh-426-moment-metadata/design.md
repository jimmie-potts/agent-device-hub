## Context

See proposal.md. #358 owns the canonical `HubEvent`, deduplication ledger and arbitration log and explicitly handed title fields to #426. The owner's September 30 instruction resumes that integration. The existing sender accepts only controller contract 1.1 fields. A design is required by the spec-driven schema because this change crosses intake and persistent log projection and changes privacy policy.

## Goals / Non-Goals

Retain a bounded event's display context in the private log without changing arbitration, timing, retries, state leases or device ownership. Device rendering beyond the delivered Tidbyt tile and future source integrations remain separately scoped.

## Decisions

Extend the existing flat event with optional `pullRequestTitle` and `meetingTitle` (160 Unicode scalars each) and `repositoryName` (80). Reuse #424's display-text validation, including credential screening. Empty, malformed, credential-like or overlong values reject the event before deduplication. Absent fields preserve the old event shape. A nested parallel metadata envelope would duplicate the canonical event and is unnecessary for these three declared fields.

Store only these fields under `event` in the existing log `detail` JSON and project them back onto the log entry's event. This uses the existing owner lease and bounded 5,000-entry log without new tables or database migration. Dedicated columns would require migration without a query requirement. Existing null detail and receipt/start detail remain readable.

Preserve #335's strict sender and controller wire shape. Event metadata identifies a logged moment; device-specific text rendering needs its own contract and issue. The lifecycle source still supplies neutral IDs, and hooks remain bounded and fail open. Metadata never changes event identity or enables replay.

ADR 0006 permits these bounded names and task/repository text in future Pixoo #94 image queries under the policy. It grants no content-capture implementation, filesystem access, provider installation or external publication.

## Risks / Trade-offs

- Names can reveal work context. Keep the existing authenticated private log and screen all fields before persistence; credential screening does not claim to classify every possible secret.
- Existing logs omit metadata. Read them unchanged; do not infer or backfill names from identifiers.
- A metadata-only rename with the same event ID remains a duplicate. Preserve event identity and do not resend moments to refresh names.

## Migration Plan

Source-only delivery with no live-state migration. Existing events and logs remain compatible. Prior releases remain immutable; this change does not republish Hub 0.4.0 or change lifecycle/state consumer pins. A future Hub publication needs a fresh version and merged-source provenance. Reverting the source removes metadata projection without rewriting stored state; old code ignores the added JSON detail key.
