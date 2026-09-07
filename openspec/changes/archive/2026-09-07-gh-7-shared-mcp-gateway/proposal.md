## Why

[Hub #7](https://github.com/jimmie-potts/agent-device-hub/issues/7) gives local device integrations one embeddable MCP transport and tool implementation. Pixoo and Nanoleaf need to call their existing command owners through the delivered controller contract without creating another device writer or reproducing authentication and replay rules.

## What Changes

- Add an opt-in authenticated Streamable HTTP module with bounded initialization sessions, strict registered targets, common device discovery, status, power and brightness tools.
- Export registration, explicit default-device binding, transport/authentication and structured result helpers for separate repository consumers.
- Preserve controller-issued request identities, configuration revisions, generations, receipts and possible prior effects. Client disconnects cannot stop admitted backend work or retry ambiguous writes.
- Pin the supported initialization-based MCP protocol and SDK artifact/license. Add fake protocol client fixtures for Codex and Claude conventions, with installed-client acceptance recorded separately.
- Produce a versioned private npm archive with a manifest, checksum and isolated consumer tests. Bundle the private controller-contract dependency so consumer CI needs no newly provisioned cross-repository credentials.

## Capabilities

### New Capabilities

- `shared-mcp-gateway`: Authenticated embeddable device MCP, configured registration, typed operations and portable distribution.

### Modified Capabilities

None. Controller contract API 1.0 and artifact 1.0.0 remain unchanged.

## Impact

Adds `packages/mcp`, package/transport/protocol tests, development commands and configured CI jobs. Update architecture and development documentation to identify the implemented module accurately.

[Pixoo #24](https://github.com/jimmie-potts/divoom-app-upgrade/issues/24) embeds the module in its existing backend. [Nanoleaf #33](https://github.com/jimmie-potts/codex-nanoleaf/issues/33) connects it to the controller API owned by [Nanoleaf #28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28). The shared contracts prerequisite is [Hub #4](https://github.com/jimmie-potts/agent-device-hub/issues/4).

Standalone hosting, aggregate discovery and agent/session tools remain in [Hub #13](https://github.com/jimmie-potts/agent-device-hub/issues/13). Pixoo media tools remain in [Pixoo #25](https://github.com/jimmie-potts/divoom-app-upgrade/issues/25). Personal client configuration, agent launches, physical acceptance, tunnels and hosted access are outside this source change.
