## Context

The service definitions place Hub below Nanoleaf's runtime parent and share its Node executable. Existing receipts predate a shared schema. See proposal.md for scope and motivation. Design is required by the schema's cross-cutting data-model and migration criteria.

## Goals / Non-Goals

**Goals:** Make provenance, ownership, compatibility and recovery evidence inspectable before a consumer stops services. Preserve current wire APIs and historical installation records.

**Non-Goals:** Implement an installer, qualify live recovery or change current services. No shared installer library or new deployment platform.

## Decisions

Use a separate Draft 2020-12 schema and validator entrypoint within contracts 1.2.0; controller validation remains unchanged. Closed shapes and conditional outcome rules reject false success. Shared fixtures exercise both languages and the extracted archive. Cross-field identity equality and timestamp ordering are validated by the language entrypoints; JSON Schema alone cannot compare arbitrary fields.

Use separate Hub and Nanoleaf current anchors. Stable component forwarding links traverse only their owning anchor; the shared parent and Node are excluded from both release payloads. Immutable release stores contain code and dependencies; mutable state, receipts, shared tools and migration history remain outside them. Two-order walkthroughs qualify the layout; consumer fake-service tests must later qualify its execution.

Use a tagged legacy identity with verified content hashes only for first-adoption recovery. New release identities require full source SHA, archive hash and manifest hash. No inferred historical success: the gh417/gh355 mapping records missing evidence explicitly.

A routine operation requires tested bidirectional state compatibility before outage. Recovery reopens the latest durable state, never imports an earlier snapshot. A backup is a separately supervised recovery resource. A lost final receipt produces failure and requires inspection, even if health passed.

## Risks / Trade-offs

- Schema validity cannot prove runtime truth → require observed process, health, provenance and durable-write evidence in consumer acceptance.
- Two forwarding layers can leave partial first adoption → fence each owner, retain originals and durable intent, refuse automatic continuation after interruption.
- Independent locks cannot coordinate replacement of shared Node → both routine updaters exclude it; any Node maintenance is separately scoped and coordinates both owners.
- Strict compatibility can refuse useful upgrades → use a separately reviewed migration procedure, never a force flag.

## Migration Plan

This change publishes only the contract. Consumers pin its immutable commit/archive receipt after owner approval. They implement fake-service recovery tests before offering their own reviewed migration. Existing contracts 1.0/1.1 artifacts and installation history remain intact.
