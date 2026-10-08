## Context

See proposal.md. This crosses the existing reader, module bus, lifecycle schema and owner admission boundary, so schema criteria require this design. The owner approved the bounded contract addition on #990.

## Goals / Non-Goals

**Goals:** preserve two existing Desktop behaviors through the current reader and lifecycle family.

**Non-Goals:** services, indexing frameworks, migrations, benchmarks, producer edits or installed acceptance.

## Decisions

Add metadata-observed with optional archived boolean and the existing title field. At least one is required, the source is restricted at core intake, and its identity is Codex Desktop. Reusing activity/read/runtime-end events would misstate evidence; SDK request replies cannot return arbitrary metadata. Credentials already reserve module sources, and the edge binds each message source to its credential.

Archive scans distinguish complete empty results from unavailable results; both clear earlier positives, while positive evidence alone prevents admission. The core keeps a scoped in-memory cache, refreshed at 2 s and expiring at 7 s, and supplies agent-state's existing ancestor-aware predicate. It does not remove existing sessions. Timeout clears module-held positives at 5 s; expiry protects against a failed/stopped publisher.

A narrow queued setTitle owner operation reuses metadataObservedAtMs, title validation and existing commit discipline. Metadata cannot establish a session, clear hostSessionId or change lifecycle/restart freshness. No persistent schema changes.

The child reader ports bounded index-tail lookup and filename-only archive scanning. IPC transfers validated titles and IDs; it never transfers transcript contents. Paths remain private. The existing poll, deadline, backoff and stop rules hold.

## Risks / Trade-offs

[Polling gap] → admission uses the most recent confirmed scan; missing evidence fails open.

[Stalled source] → existing child isolation and timeout, then expiring admission evidence.

[Title metadata races] → preserve metadata timestamp comparison and explicit-label precedence; a title-only commit cannot refresh lifecycle evidence.

## Migration Plan

Source-only delivery. No data transfer or migration. Installation occurs at #840; old Hub code stays unchanged.
