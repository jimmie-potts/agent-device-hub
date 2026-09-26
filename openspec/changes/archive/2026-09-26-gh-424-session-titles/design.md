## Context

The owner approved the contract on 2026-09-26 before producer changes. Main at `490ad5a` uses lifecycle 1.0, snapshot 1.0/1.1, durable 2.0 and agent-state 3.2.0. Closed schemas make silently adding fields incompatible. This design is required because the change spans contracts, persistence, hooks and UI.

## Goals / Non-Goals

Deliver title/project metadata through the existing owner. Preserve identity, lifecycle uncertainty, queues and device ownership. No prompt, response or transcript-content capture, installation, live migration or device operation. No self-label identity/tool implementation from #372.

## Decisions

- Lifecycle 1.1 adds optional `title:{value,source:"provider"|"user"}`, optional `project`, and `label.origin:"agent"|"user"`. Title is at most 160 Unicode scalar values; project and label are at most 80. Text is nonempty and control-free. Credential fields remain forbidden and recognizable credential strings are rejected. Text mentioning prompts is permitted; extra prompt/response/transcript payload fields are still outside the implemented schema.
- `project` is presentation; `projectId` retains its existing identity meaning. Producers derive only a basename, never the full cwd. A provider title does not become an owner label. Claude custom-title has user provenance; ai-title and the Codex index have provider provenance unless a source proves otherwise.
- The owner retains label origin, protecting an existing user label from agent-origin writes. Explicit owner clearing removes the label; later provider title updates cannot reinstate it. Legacy labels without provenance are treated as user labels. A later agent label may fill an unlabelled session.
- Snapshot 1.2 exposes metadata and generation. Default 1.0 and opt-in 1.1 remain closed legacy projections, omitting new fields and agent-origin labels rather than presenting them as owner labels. HTTP selects 1.2 explicitly; the current Hub MCP and dashboard adopt 1.2.
- Durable 2.1 records metadata/provenance. Existing 1.0 and 2.0 inputs remain accepted; source tests cover conversion with one exclusive owner. Older packages cannot reopen 2.1. Deployment is separately authorized and must preserve a pre-upgrade export; reverting after metadata writes requires a compatible owner, not an unsafe old reader.
- Pure normalization remains usable without filesystem access. A bounded asynchronous metadata reader enriches hook envelopes, using Codex session_index.jsonl or only Claude custom-title/ai-title records. It never copies other transcript records. Child events never inherit a parent's title or cwd as if they described the child. Missing, malformed or inaccessible metadata is omitted without dropping the lifecycle event.
- Reads have byte/record and time limits inside the existing three-second process deadline. Oversized metadata is omitted to retain the 2,048-byte normalized envelope. No subprocess, git invocation, device request, retry or live-source qualification is added.
- Packages tentatively become lifecycle 1.1.0, agent-state 3.3.0 and Hub 0.4.0. Recheck current versions/tags before publication. Build and verify archives at reviewed merged source; preserve historical vendor artifacts and receipts. A released lifecycle archive must be pinned before the downstream agent-state publication/adoption.

## Risks / Trade-offs

- Large indexes/transcripts may exceed the read window → omit unavailable metadata, retain neutral fallbacks and test fail-open behavior.
- Native title records do not prove user authorship → preserve the conservative provenance above.
- Unordered delayed metadata could restore a prior name → retain a metadata observation watermark without using names to infer lifecycle freshness.
- Credential detection cannot recognize arbitrary secret-looking prose → allowlist source fields, reject credential fields and known credential signatures, and never log discarded input.
- A durable format bump limits old-package rollback → document the compatibility boundary and exercise synthetic import/restart tests; do not migrate live data.

## Migration Plan

Publish new immutable package bytes and checksums tied to the reviewed main revision; consumers pin and verify them. Retain old release bytes. Source fixtures exercise old/new producer and snapshot combinations, metadata absence, rename, explicit labels, restart and malformed input. Installation and physical observations remain pending. Human approval of the dashboard candidate precedes merge.
