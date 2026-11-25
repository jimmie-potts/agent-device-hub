## Why

The Mac worker can run Claude Code, while Conversation and delivery orchestration
need a worker that can also use the owner's Codex subscription independently of
the supervisor's provider. [Hub #2111](https://github.com/jimmie-potts/agent-device-hub/issues/2111)
owns the shared adapter work for Hub #1722.

## What changes

- Register worker adapters by harness identity. Add Codex beside the retained
  Claude Code adapter.
- Report safe readiness, capabilities, native session identity and structured
  results through additive coding family versions.
- Refuse incompatible or contrary authority and keep loss after dispatch
  uncertain.

## Capabilities

### Modified capabilities

- `bunny-coding-delegation` gains multiple subscription worker adapters and
  attributed readiness, progress and results.

## Impact

The worker and coding message consumers change. The connection-bound
coding-worker grant and existing routing families remain the boundary.
