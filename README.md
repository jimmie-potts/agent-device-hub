# Agent device hub

Shared local agent status and device integration contracts for Codex, Claude Code,
Nanoleaf, Pixoo, Tidbyt and LIFX.

This repository currently contains accepted architecture, the implementation
backlog and development workflow tooling. No collector, runtime API, MCP server,
dashboard or device adapter is implemented or installed.

New Tidbyt and LIFX controllers will live in this monorepo. Their current
[Tidbyt](controllers/tidbyt/README.md) and [LIFX](controllers/lifx/README.md)
directories contain documentation and scoped agent instructions only. The first
feature priority for these devices is automatic agent status. Tidbyt starts with
the official cloud and leaves a connection boundary for future Tronbyt support;
LIFX uses direct LAN control. See [ADR 0003](docs/decisions/0003-device-controller-monorepo.md).

Read [architecture](docs/architecture.md) for ownership and migration decisions,
[the roadmap](docs/roadmap.md) for the linked delivery sequence, and
[development](docs/development.md) for setup. GitHub issues own scope, acceptance,
dependencies and status. A completed bootstrap is not a working device integration.

## Validate the bootstrap

Use Node 24 and npm from the repository root:

```bash
npm ci
npm run check:workflow
npm run test:workflow
```

OpenSpec 1.12.0 is pinned. The specification inventory is intentionally empty.
The fixture suite exercises the validation tooling, not agent or device behavior.

## Development with agents

[AGENTS.md](AGENTS.md) owns repository instructions. [CLAUDE.md](CLAUDE.md) imports
them for Claude Code. Reusable methods remain in the
[agent-skills catalog](https://github.com/jimmie-potts/agent-skills).
Read [the delivery workflow](docs/sdlc.md) before planning or changing this project.

The canonical local checkout is `/home/jimmie/projects/agent-device-hub`.
Use a separate branch and worktree for each deliverable. Source delivery does not
install hooks, launch agent sessions, start a personal service or operate devices.

## Related repositories

- [Pixoo](https://github.com/jimmie-potts/divoom-app-upgrade) retains its media,
  persistence, playback and physical-device operation queue.
- [Nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf) retains its Windows
  worker, Line allocation, spatial effects, scene restoration and wall editor.

The first shared core can run in Pixoo's existing backend. Standalone hub hosting
and Nanoleaf shared-input migration are separate, dependency-gated deliverables.
Later source moves into this monorepo have separate deferred issues,
[Pixoo #25](https://github.com/jimmie-potts/agent-device-hub/issues/25) and
[Nanoleaf #26](https://github.com/jimmie-potts/agent-device-hub/issues/26).
Their current repositories retain ownership until those migrations are delivered.
