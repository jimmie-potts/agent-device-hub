## Why

The Mac Codex hook wrapper forwards five root events and drops PermissionRequest and every payload with `agent_id`, although the runtime's supported-source definition already maps Codex approvals and subagents. A Codex approval on the Mac never reaches the hub or its devices, and Codex subagents never appear as child sessions. [#1867](https://github.com/jimmie-potts/agent-device-hub/issues/1867) (part of epic #1896) closes that gap, by the owner's decision of 2026-11-19.

## What Changes

- The wrapper also forwards root PermissionRequest with its turn, and SubagentStart and SubagentStop with the child's `agent_id` under the parent's `session_id`. It forwards no other field: no prompt, tool name or input, agent type, transcript or path.
- A child never carries a turn: the wrapper drops the subagent payload's `turn_id`, and the adapter's existing child mapping gives the child an unknown turn.
- Any other payload with `agent_id`, a child's PermissionRequest among them, is still dropped whole.
- The hook adapter, the lifecycle 2.0 contract and the core are unchanged. Approvals without a request ID keep the core's existing rules.
- The synthetic Mac Codex capture also shows an approval and a subagent.
- No per-tool-call hook is added.

## Capabilities

### Modified Capabilities

- `runtime-agent-hooks`: the local Mac Codex wrapper's forwarded set gains root PermissionRequest and the two subagent events.
- `portable-runtime-acceptance`: the metadata-only connector journey shows the approval and the child session.

## Impact

`apps/runtime/bin/mac-codex-hook.mjs`, its tests, a direct adapter and core test, the `mac-codex-local` capture, `docs/mac-codex-hook-qualification.md`, `docs/provider-qualification.md` and `apps/runtime/verify/PORTABLE.md`. No message format, contract version, core rule or stored state changes. Installing the wrapper and changing the Mac client's hook configuration are separate, under [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869).
