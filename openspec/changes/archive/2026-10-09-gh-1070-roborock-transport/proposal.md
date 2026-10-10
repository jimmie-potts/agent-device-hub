## Why

B.U.N.N.Y. needs a read-only TypeScript connection before it can collect the owner's vacuum history. [Hub #1070](https://github.com/jimmie-potts/agent-device-hub/issues/1070) delivers that source transport; #376 consumes it in the runtime module.

## What Changes

- Add a narrow transport under `modules/roborock/transport/src/transport`, with typed methods for status, consumables, cleaning summary, one record, room mapping and current-map bytes.
- Adapt only necessary local V1 and vendor-MQTT primitives from the MIT-licensed ioBroker.roborock revision `ce998f6980b9928af800d8083cbe794f3b93ca97`, preserving attribution.
- Enforce an RPC allowlist at the final sender, bounded framing/map decoding, serialized reads, deadlines, cancellation and stop fencing.
- Provide explicit interactive account setup and private session loading, tested only with synthetic account endpoints and credentials.
- Register build, strict lint, transport tests and contract-consumer validation in scripts, CI and development guidance before executable implementation.

## Capabilities

### New Capabilities

- `roborock-read-transport`: Explicit account/session setup and bounded read-only local/MQTT access with safe registry errors and synthetic protocol evidence.

### Modified Capabilities

None. The transport is not registered with the running application in this story.

## Impact

Adds a private workspace package under `modules/roborock`, focused tests, provenance guidance and check wiring. Uses the existing SDK diagnostic and event error contracts under ADR 0012; no new message family is served. No controller port, Python daemon, installed broker, discovery, controls, collector, persistent history, page or MCP tool is introduced. Account/device use and exact-firmware compatibility remain separate owner-authorized acceptance in #376. The module will consume raw map bytes privately rather than broadcast them.
