## Context

See proposal.md. The shipped companions module already owns an SDK SQLite connection, outbox and React page. Core owns authorization, operations and agent sessions. ADR 0012 governs handoffs and outcomes; ADR 0011 governs private retention. The issue supplies the execution bounds and acceptance boundary.

## Goals / Non-Goals

Qualify durable pause/restart/resume in one sequential graph using fake functions. Do not add model/provider registries, workers, transports, shared agent-state ownership, real tools, retention expiry or installed effects.

## Decisions

Use pinned LangGraph with a module-local BaseCheckpointSaver over the existing node:sqlite connection. The packaged better-sqlite3 saver cannot share it. Qualify interrupt recovery and pending writes first; never hold a SQL transaction across an await. A checkpointer failure blocks dependent implementation rather than authorizing another database owner.

Keep domain records separate from opaque checkpoints. Stable task identity maps to thread_id; fixed logical call ordinals derive effect IDs. Reserve before calling, reuse saved results and refuse unknown admitted calls. Checkpoint/domain projection gaps are reconciled idempotently by reading saved graph state at startup. Startup never invokes the graph. Unsupported graph versions retain readable history and refuse resume.

The graph interprets a bounded prompt, interrupts for clarification, reads an immutable fixture and composes a result. Interrupt nodes make no external calls before interrupt. Each explicit activation gets a new run and cancellation fence. Persist answers before scheduling continuation. Check fences and limits before and after awaits; reserve time conservatively across crashes. Cancellation cannot undo a dispatched effect or claim a durable save on full disk.

Stage JSON through the SDK upload hook; command payloads contain only opaque bound references. Use additive assistant-input/control/state families. Current state contains metadata only; content reads paginate retained messages under the existing read permission. The ordinary Command UI reports local admission separately from task outcome. Existing Reachy functionality and first-live coding eligibility remain independent.

Use the existing outbox for atomic domain/state/outcome commits and original-trace republishing. Use context clock/scheduler/signal/log/trace. Extend the versioned diagnostic catalog for minimal run/model/tool records; no exporter dependency or private text. New runs link prior context and do not keep spans open across human waits or downtime.

Model functions are bounded text inference seams. Future coding-worker dispatch is a separate capability. Future workspace links use `{owner: "companions", conversationId, taskId, questionId?}`; neither connector work nor personal-memory storage belongs here.

## Risks / Trade-offs

- Saver compatibility and projection gaps → disposable process restart and injected gap tests before integration, then independent task review.
- Lost replies → persist effect admission, retain unknown usage and refuse re-execution.
- Private content duplication → opaque staged commands, bounded authenticated reads, no transcript broadcasts or diagnostics.
- Cancellation racing an await → durable generation fence and post-await checks; late results are evidence only.
- New dependency footprint → exact pins and normal full affected CI, without introducing hosted LangGraph services.

## Migration Plan

Add tables beside the existing companion tables on the SDK connection. Preserve existing Reachy records. Assistant stays disabled by default. This delivery changes source only; installed upgrade qualification belongs to the established runtime procedure and its owning issue.
