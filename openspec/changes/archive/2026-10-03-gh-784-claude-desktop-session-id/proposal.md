## Why

[Hub #784](https://github.com/jimmie-potts/agent-device-hub/issues/784) lets the CHOMPI bridge ([#742](https://github.com/jimmie-potts/agent-device-hub/issues/742), epic [#738](https://github.com/jimmie-potts/agent-device-hub/issues/738)) open the exact Claude Desktop Code session for a task. The [#740 qualification](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/chompi-controller-qualification.md) found that Desktop names each Code session `local_<uuid>`, separate from the hook `session_id`, and that the Code process environment carries `CLAUDE_CODE_HOST_SESSION_ID` with `CLAUDE_CODE_ENTRYPOINT=claude-desktop`. On 2026-10-03 the owner chose to capture that ID through the Hub's own hook, and to keep it only in the owner's memory rather than in durable state.

## What Changes

- Lifecycle 1.2 adds one optional root-session field, `hostSessionId`, using the existing neutral identifier grammar. Lifecycle 1.0 and 1.1 keep their strict shapes and reject it.
- With lifecycle 1.2 selected, the Claude provider reads `CLAUDE_CODE_HOST_SESSION_ID` from the hook environment only when `CLAUDE_CODE_ENTRYPOINT` is exactly `claude-desktop`. It adds the value only after validation; anything else is omitted and the event is still emitted. No other environment value is read.
- The state owner keeps the latest value per session identity in memory for its lifetime and serves it through opt-in snapshot 1.3. Durable format 2.1 and its schemas are unchanged, so exports and stored bytes never contain the field. It is never a session identity and never merges records.
- `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and `hub_sessions` expose the field. Default and older snapshot projections are unchanged.
- Setup accepts `lifecycleVersion:"1.2"`; existing producer configurations keep their current version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-lifecycle-contract`: versioned optional host session identifier.
- `agent-provider-emitters`: bounded, fail-open Claude Desktop environment read.
- `agent-state-core`: memory-only per-session value and snapshot 1.3.
- `standalone-hub-host`: versioned session route for the field.
- `standalone-hub-mcp`: session tool reads snapshot 1.3.
- `shared-monitor-installation`: explicit producer selection of lifecycle 1.2.

## Impact

Lifecycle contracts (schemas, TypeScript and Python validators, shared corpus, package 1.2.0), agent-state (provider, hook, owner, snapshot schema and corpus, package 3.5.0), Hub routes, MCP, setup, hooks and packaging (0.6.0), and their docs. Claude CLI sessions, Codex producers, the dashboard, Tidbyt and other snapshot consumers keep their behavior. The bridge's use of the field belongs to #742. Installing this revision through the guarded upgrade waits on the installer compatibility change in [#794](https://github.com/jimmie-potts/agent-device-hub/issues/794); source delivery does not install, change hooks or select the new version for a running producer.
