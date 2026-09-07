## Why

[Hub #4](https://github.com/jimmie-potts/agent-device-hub/issues/4) gives local MCP clients and the existing device controllers one versioned boundary. Without it, the TypeScript Pixoo service and Python Nanoleaf worker would independently define identity, uncertainty, replay and observation freshness.

## What Changes

- Add a versioned contracts package containing strict JSON schemas, TypeScript exports and shared Python/TypeScript conformance fixtures.
- Define configured identity and capabilities, command/result envelopes, observation snapshots, bounded change feeds and renderer clock metadata.
- Define machine-client authentication, admission and replay requirements without implementing a network server or device writer.
- Add product build/type/contract checks to development instructions and CI before implementing the contracts.

## Capabilities

### New Capabilities

- `controller-contracts`: Versioned controller messages, compatibility and cross-language conformance.

### Modified Capabilities

None. This is the first product contract in this repository.

## Impact

Adds `packages/contracts`, conformance fixtures and contract documentation. [Hub #7](https://github.com/jimmie-potts/agent-device-hub/issues/7), [Nanoleaf #28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28), and [Pixoo #37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37) consume this boundary in their own scope. Controller databases, physical transports and personal installations remain owned by the existing applications.
