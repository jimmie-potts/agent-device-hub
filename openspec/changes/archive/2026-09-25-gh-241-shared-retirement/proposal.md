## Why

[Hub #241](https://github.com/jimmie-potts/agent-device-hub/issues/241) requires one shared-owner retirement rule for every supported provider/client path. [Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218) delivered retirement for Codex Desktop only; an ended Codex CLI or Claude Code record still waits for the 24-hour expiry, which keeps [Nanoleaf #110](https://github.com/jimmie-potts/codex-nanoleaf/issues/110) in Work after the agent is gone.

## What Changes

- Apply #218's atomic retirement, bounded delayed-event guards, fresh generations and known-descendant handling to Codex Desktop (`codex`/`desktop`), Codex CLI (`codex`/`cli`) and Claude Code (`claude`/`code`) alike. An accepted `runtime.ended` retires the known record and its known descendants in one durable revision, even when notices or attention remain.
- Keep every non-end unchanged: `Stop`/`turn.ended`, `SubagentStop`, interruption, waiting, completed/read status, freshness uncertainty and long turns retain records; the 24-hour evidence expiry remains the only fallback.
- Settle stores written by the previous owner: records holding an accepted end as activity `ended` are retired at startup in one revision with the same guards; idle, waiting or unknown records keep their evidence clocks. The reducer no longer produces `ended`.
- Keep Codex Desktop archive admission specific to that client. Record the documented end/start mappings for each path and the remaining installed gaps.
- Parameterize the owner, Tidbyt, dashboard and consumer-harness checks over the three paths and add mixed-path checks. Consumers change only where a check demonstrates a gap; none did.
- Agent State 3.2.0 and Hub 0.3.4 carry the policy; durable format 2.0 and snapshots 1.0/1.1 are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: runtime-end retirement on every supported path, mixed-path preservation, and startup settlement of stored accepted ends.
- `agent-lifecycle-contract`: session-end interpretation covers every supported path without a new wire field or cause detector.

## Impact

The shared state package, Hub host, TypeScript/Python validators and the focused Tidbyt, dashboard, Pixoo and Nanoleaf checks are affected. No new service, policy registry, provider watcher, historical replay, cleanup UI or per-device command. Complexity is medium (provider mappings, durable transitions, consumer checks); uncertainty is medium because installed emission on the newly covered paths remains unobserved; impact is high because incorrect identity/order handling could remove another live task's monitoring state, which the mixed-path and guard checks address. Installed qualification of a normal end and resume per CLI/Claude path needs separate authorization; visible-light checks need a named device.
