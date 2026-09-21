## Why

[Hub #13](https://github.com/jimmie-potts/agent-device-hub/issues/13) connects the delivered standalone host to the reusable MCP module. Local clients need qualified session inspection and protected integration controls through the same owners as HTTP callers.

## What Changes

- Add an opt-in `/mcp` route on the existing loopback listener using the shared transport, authentication checks and bounded admission.
- Register host session inspection, label and exact-notice acknowledgment tools plus configured-device discovery and capability-aware device/integration operations.
- Preserve native identities, request tickets, revisions, generations, replay and uncertainty through the existing host services. Reads and reconnect never submit writes.
- Exercise both existing Codex/Claude protocol profiles with synthetic credentials, disposable host storage and fake controllers; package the complete dependency closure.

## Capabilities

### New Capabilities

- `standalone-hub-mcp`: Authenticated local MCP composition over the standalone state and controller services.

### Modified Capabilities

None. Existing shared MCP, controller and state contracts remain authoritative.

## Impact

Changes affect `apps/hub`, its private artifact dependency closure, host integration tests, development checks and the work guide. Controller API 1.0 and the pinned `pixoo-integration/1.0` and `nanoleaf.integration/1.0` extensions remain unchanged. No installation, remote listener, migration, agent launch, device operation or public publication is included.
