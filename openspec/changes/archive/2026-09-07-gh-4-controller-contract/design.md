## Context

The repository has no existing product contracts. The accepted cross-repository architecture retains the Pixoo services and Nanoleaf Windows worker. See proposal.md for the motivation and docs/controller-contract.md for the field and protocol design.

## Goals / Non-Goals

Goals: strict portable wire schemas, explicit evidence and supported capabilities, identical pure conformance decisions in TypeScript and Python, and a versioned distributable artifact.

Non-Goals: network authentication servers, physical device writers, monitoring state, animation scheduling, personal setup or controller adoption.

## Decisions

Use strict Draft 2020-12 JSON Schema with safe integer counters and literal API 1.0. Include schemas and fixtures in @jimmie-potts/device-contracts 1.0.0. TypeScript uses Ajv and Python uses jsonschema to exercise the same corpus. Reject unknown fields and versions instead of accepting unqualified extensions.

Use server-issued epoch/sequence tickets and a 256-receipt default with a retained high-water mark. Expired identities cannot become fresh after eviction. Match Pixoo's current sequence convention rather than introduce a TTL-only retry cache. Authenticate before any replay. Reserve sequence atomically before semantic evaluation; capacity rejection does not consume it. Pure reference evaluators describe these requirements, while later owning-controller issues prove actual queue and HTTP enforcement.

Keep configuration revisions, output generations, feed cursors and clock epochs distinct. Compare controller durations within the controller clock epoch; never subtract process-local clocks. Advertise optional device profiles and modes without a shared animation scheduler. Unknown telemetry stays unknown after health checks.

Keep credentials, raw destinations and private database paths outside wire payloads. Native credentials are separate from browser editing tokens, including rotation/revocation and scope checks. Default finite bounds follow the existing Pixoo API. The full contract and fixture inventory are in docs/controller-contract.md.

## Risks / Trade-offs

Strict schemas require explicit minor-version negotiation for additive fields. A package manifest and shared conformance tests make changes reviewable. Reference fixtures do not establish downstream integration or physical success; those remain the owning issues' acceptance.

Full snapshots per change event are larger than deltas but simplify bounded resync and prevent partial client state. Render profile payloads remain device-owned.

## Migration Plan

No runtime migration occurs here. Produce a source-versioned package with a manifest and hashes, verify imports outside the checkout, and pin an immutable artifact plus checksum before a second repository adopts it. Preserve the previous artifact for rollback; never import a sibling worktree or open another owner's SQLite database.
