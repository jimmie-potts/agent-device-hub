## Context

See proposal.md. Snapshot 1.2 already defines bounded `title.value`, `title.source`, `project` and label provenance. The shared feed currently requests the default 1.0 projection, which omits that metadata. This cross-module change warrants a design under the spec-driven schema.

## Goals / Non-Goals

Use the existing state owner and queue. Do not add lifecycle interpretation, metadata capture, state mutation, moment dispatch, installation or physical tests.

## Decisions

Keep the current ten-character label area beside the state word within the fourteen-column text area. Prefer `label`, `title.value`, `project`, `projectId`, then the existing neutral hash. The state owner has already resolved explicit-label precedence; the renderer does not reinterpret provenance. Keep the existing font normalization and truncation.

Add an optional snapshot version selection to the shared feed and opt Tidbyt into 1.2. Preserve its default request for existing LIFX consumers. Validate returned snapshots and reject a mismatched selected version rather than silently losing titles. Keep the existing timeout, owner check and unavailable-feed behavior.

ADR 0005 permits bounded media titles and filenames through device-owned contracts; it grants no filesystem access. Credential and token exclusions remain. The canonical moment owner must settle its field names and fixture before that surface changes.

## Risks / Trade-offs

Long titles truncate to ten display characters; the state word remains visible. An older hub that cannot serve 1.2 produces the existing unavailable-feed presentation. Deployment must pair this consumer with the #424-capable hub; no installation occurs here.

## Migration Plan

Source-only consumer update, with existing default consumers unaffected. Rollback is a source revision; no stored state or configuration migration is needed.
