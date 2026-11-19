## Context

The wrapper (`apps/runtime/bin/mac-codex-hook.mjs`) sanitizes the client's JSON before the runtime hook reads it. The runtime hook adapter (`apps/runtime/src/hook/adapter.ts`) then builds the lifecycle 2.0 observation, and both ship in the same host release. The adapter already maps Codex PermissionRequest to `attention-approval` with an unknown attention ID, and maps SubagentStart and SubagentStop to `session-started` and `turn-ended` for the child `agent_id` under a known parent, with an unknown turn. The [Codex hook reference](https://learn.chatgpt.com/docs/hooks) documents `turn_id` on PermissionRequest, `agent_id` and `turn_id` on both subagent events, and the parent's `session_id` for subagent hooks. It does not say whose turn a subagent's `turn_id` is, or whether PermissionRequest runs inside subagents.

## Goals / Non-Goals

**Goals:** forward the three hooks with identity only; keep the core, its contract and every older host's behavior unchanged.

**Non-Goals:** an approval request ID or any inferred correlation; a tool-call hook; installing the wrapper or changing the client's hook configuration (#1869); changing how the core clears approvals or reads interruptions.

## Decisions

1. **The wrapper selects, the adapter maps.** The wrapper adds the three hook names to its allowlist and keeps the adapter as the only mapping. Alternative: a Mac-specific mapping in the wrapper. Rejected: two mappings could disagree, and the adapter's child rules already guard the same cases.
2. **A root PermissionRequest needs a valid `turn_id`.** The core forgets an approval without a request ID only at its own turn's end or when a newer turn retires that turn. An approval on an unknown turn would stay until the session ends. Without a valid turn, the wrapper sends nothing.
3. **A subagent event forwards `session_id` and `agent_id` only.** The documented `turn_id` may be the parent's turn, so it is dropped before the adapter sees it. The adapter would ignore it anyway; dropping it keeps the parent's turn out of the hook process's input. `agent_type` is a client profile name that the mapping does not use, so it is dropped too.
4. **A child's PermissionRequest stays dropped.** Its approval would have the child's unknown turn, so the child's SubagentStop could not clear it. It would stay until the parent's runtime end, and the reference does not establish that the event runs in subagents. Attributing it to the parent would invent correlation. Actual-client observation under #1869 may revisit this.

## Risks / Trade-offs

- [Each new hook is one more blocking Node process: about 160 ms each on the owner's PC, which delays the approval prompt and the subagent's start and stop by that much] → Measured in the disposable exercise; Mac numbers belong to #1869, before the hook configuration changes.
- [A child approval, if Codex emits one, stays invisible] → Recorded in `docs/provider-qualification.md` as a gap for #1869.
- [The core reads an unordered Interrupt as ambiguous work, keeps the interrupted turn's approval until a newer turn or the runtime end, and reads a subagent's stop, which has no turn, as ambiguous child work] → Existing core rules for every source, recorded and pinned by tests; changing them is separate work.

## Migration Plan

No stored state or contract changes. An older wrapper keeps sending its five root events to a new core. A newer wrapper sends lifecycle 2.0 observations whose kinds and parent rules every core has accepted since the wrapper first shipped (#1185). The lifecycle 2.0 schema and its validator rules are unchanged since then. Rollback is the previous wrapper release. Hooks fail open, so any refusal is silent.
