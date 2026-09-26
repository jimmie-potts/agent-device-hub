## Why

[Hub #424](https://github.com/jimmie-potts/agent-device-hub/issues/424) makes sessions recognizable by their provider title and project while preserving owner labels. The owner approved the field design in chat on 2026-09-26.

## What Changes

- Add lifecycle 1.1 title/source, separate project display name and agent label provenance, retaining lifecycle 1.0 validation.
- Add snapshot 1.2 and durable 2.1; retain legacy snapshot projections and import existing stores.
- Read bounded Codex index and Claude title records in observational hooks, with basename-only project display names.
- Persist renames; expose metadata through HTTP, MCP and B.U.N.N.Y.; align labels at 80 Unicode scalars.
- Replace the content-exclusion policy while retaining credential exclusions. Prompt/response/transcript-content capture remains outside this implementation (#425).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-lifecycle-contract`: versioned title/project and label provenance.
- `agent-provider-emitters`: bounded metadata lookup without losing lifecycle events.
- `agent-state-core`: persistence, precedence and explicit snapshot compatibility.
- `standalone-hub-host`: versioned sessions and consistent label validation.
- `standalone-hub-mcp`: title/project discovery and aligned labels.
- `unified-dashboard`: shared title/project presentation.

## Impact

Lifecycle/agent-state packages, authenticated Hub routes and hooks, Python validators, release packaging, dashboard and contract fixtures. Downstream adoption belongs to [Pixoo #106](https://github.com/jimmie-potts/divoom-app-upgrade/issues/106), [Nanoleaf #179](https://github.com/jimmie-potts/codex-nanoleaf/issues/179) and [Hub #426](https://github.com/jimmie-potts/agent-device-hub/issues/426). Existing device queues and state ownership remain unchanged. Source delivery does not install or migrate a running owner.
