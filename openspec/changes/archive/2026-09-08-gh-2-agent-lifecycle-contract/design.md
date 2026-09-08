## Context

See proposal.md for motivation and assessment. Hub already packages strict JSON schemas with TypeScript/Python conformance consumers. No shared lifecycle reducer exists. This design is required by the schema because the contract crosses repositories and governs privacy, identity and delivery timing.

## Goals / Non-Goals

Provide portable validation and an evidence vocabulary that can be consumed before an agent-state runtime exists. Keep provider qualification separate from observed installed-client compatibility. Do not implement provider hooks, a reducer, storage, listeners, migration or device commands here.

## Decisions

1. Use a separate private `@jimmie-potts/agent-lifecycle-contracts` 1.0.0 archive in `packages/lifecycle-contracts`. Reuse the established packaging convention. Adding lifecycle data to the device-command envelope would conflate observation with control and force unrelated consumers to upgrade.
2. Use a closed JSON Schema 2020-12 envelope with explicit unknown identity/evidence values. Session identity contains provider, client, hostId, sourceId and sessionId. Child identities include their actual agent ID and an evidenced parent selector; absent parent evidence never implies top-level. Provider-generated IDs must be opaque neutral identifiers. Project IDs and labels require explicit user assignment.
3. Each envelope records one event kind, turn identity when evidenced, occurrence evidence and source observation time. Attention tokens and their resolution are separate from turn-end notices and per-consumer acknowledgments. Read evidence is optional and Codex Desktop-specific. A contract interpretation helper describes an event's dimension, not accumulated state. The reducer remains Hub #3.
4. Preserve a native event ID when available. Otherwise hash the canonical validated envelope once before enqueueing and retain it for retries. Label the fallback as content-derived: identical observations may be indistinguishable and no total ordering can be inferred. Hashing private provider payloads is forbidden. Unknown turn/sequence means uncertain ordering; wall time alone cannot repair it.
5. Reject unknown fields and invalid values before return, transport or persistence. Errors contain fixed codes only. Bound serialized UTF-8 bytes, object depth and string sizes before schema evaluation. TypeScript/Python exercise the same fixtures and expected keys. A schema cannot prove that an allowed string originated from user input; the future allowlisting adapter remains a required trust boundary with privacy-canary tests.
6. Define finite producer queue/deadline requirements without claiming measured numeric performance. Hub #30 freezes measured budgets before Hub #3 implements emitters. Provider-native async mode alone is insufficient to bound process count, queue delay or shutdown behavior. Failure must be silent, observational and never emit permission/control JSON.

## Risks / Trade-offs

- Installed manifests do not prove event behavior. Keep observed, documented, unsupported and inaccessible evidence separate; missing mandatory identity or bounded delivery blocks enabling that client in #8.
- Strict schemas make additive wire fields incompatible until an explicitly negotiated version supports them. Unknown versions fail closed for monitoring data while the producer still exits successfully for the agent.
- Content-derived deduplication can collapse indistinguishable observations. Fixtures expose this uncertainty; never manufacture sequence or parentage.
- Windows/WSL clocks cannot establish transit latency by subtraction. Retain observation timestamps for display and compare durations within a monotonic clock domain during #30.

## Migration Plan

Publish only from a reviewed merged revision with an archive checksum and manifest. Downstream repositories pin those bytes, source revision and compatibility before adoption. No existing hook, installation or Nanoleaf read reconciliation changes. If qualification fails, leave that path disabled pending its named acceptance issue.
