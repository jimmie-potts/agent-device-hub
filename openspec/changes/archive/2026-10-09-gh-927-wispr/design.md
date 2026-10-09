## Context

See proposal.md and live #927. Existing `apps/hub/src/wispr*.ts`, their synthetic tests and `@jimmie-potts/wispr-contracts` already implement the reader/query behavior. Root owns #932's shared API1.3 content/frontend integration; this backend worktree starts on accepted main with API1.2. Design is required because this port crosses authorization and private-text boundaries.

## Goals / Non-Goals

**Goals:** Move proven reader/query code with provenance into a read-only fixed module; keep manually selected files, truthful freshness, clear fences and pending-read privacy invalidation. Give root a small typed adapter and exposure predicate for its existing authenticated gateway.

**Non-Goals:** Collector changes, database/persisted cache, migration, client registry, new framework/service/scheduler, MCP analytics, broadcasts, installer or real source reads.

## Decisions

- Retain the existing pure `@jimmie-potts/wispr-contracts` validator for the unchanged published files. A Wispr-only module-boundary allowance admits that package while still refusing collector, Hub and other module implementations. No other module gains access to this file contract.
- Keep the lazy worker and 30-second coalescing with its in-memory fence. Use the host worker lifetime in production; one-shot workers would discard that behavior. Read only on demand, never from a new background collector job.
- Reject all pending reads on privacy changes and track a privacy epoch through each reply. Check epoch and cancellation again when adapting completed bytes so an already-resolved old reply cannot pass. Stop rejects reads and terminates the worker. Private file/query errors become registry refusals, not uncaught module failures.
- The backend owns configuration, lifecycle and `read(route, query, signal)`; root attaches API1.3 content, page and browser-exposure behavior after shared integration. The gateway captures an internal module delivery guard before reading, then rechecks the original credential/session/read permission, browser exposure and that guard immediately before synchronous HTTP emission. The guard binds the reader instance, lifetime and privacy epoch; an opt-out between a resolved read and emission retires the reply. This closed Wispr adapter adds no general SDK contract.
- Preserve published file validation and numeric/language calculations. Runtime response documents use the existing schema convention and shared ErrorBody; ordinary exports remain numeric. Root owns CSV MIME/attachment and exact shared response integration.
- Settings are a safe read projection of the module's one manually entered configuration path; paths never appear in returned settings. No GUI writer or conversion exists.

## Risks / Trade-offs

- Broader read-scoped client access is the owner-accepted tradeoff; exposure and text permissions remain separate and tested.
- A completed worker reply can outlive an opt-out; pending invalidation, adaptation checks and the final delivery guard prevent emission.
- A generation clear with a missing replacement must not revive old data; preserve existing fence tests and worker-replacement authority.
- Source/API1.3 integration proceeds concurrently; shared SDK/gateway/frontend files remain root-owned. Backend tests cannot qualify those routes or UI.

## Migration Plan

No migration. #840 enters selected paths and flags manually in fresh private configuration during its owner-present setup. The Windows collector and files stay unchanged. Old installation/state remain untouched; source tests use synthetic files only.
