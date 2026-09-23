## Context

Codex `PermissionRequest` can identify a turn but does not supply the tool request ID needed to match a later result. The owner therefore retains an unknown-ID approval. Age and collector health cannot prove that a permission was resolved. The user chose to keep red with uncertainty until matched evidence or an explicit recovery action.

## Decision

The shared owner supplies `recoverApproval(identity, turnId, expectedRevision)`. It serializes with ingest and other commands, checks the current revision, known current turn, uncertain freshness and exactly one matching unknown-ID approval. It commits only that item's removal and an `attention.recovered` journal entry. The HTTP monitor command and MCP control tool use existing authentication and replay behavior. Neither path contacts Codex or a device.

## Failure and recovery

Fresh evidence, a changed revision or turn, and ambiguous matching attention fail without mutation. A storage failure follows the owner's existing fault semantics: no speculative revision is published. A lost HTTP response can be retried with the same request ID; a new attempt first rereads the current snapshot. A later provider observation may create new attention. A restored owner retains its durable journal and state; no automatic recovery runs on restart.

## Scope

The version 1.0 durable schema adds a journal kind while retaining the same state shape. New private package versions identify the changed contract. Downstream consumers must update their validated snapshot behavior independently. Installation and physical-light acceptance remain separate.
