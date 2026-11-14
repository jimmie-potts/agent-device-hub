## Why

[ADR 0016](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/decisions/0016-brain-and-local-edges.md) keeps one authoritative core on the Mac. [Issue #1830](https://github.com/jimmie-potts/agent-device-hub/issues/1830) removes the superseded settings replication and standby source.

## What Changes

- **BREAKING** Remove standby startup, its inbound admission and the settings peer. Refuse stale configuration before startup.
- **BREAKING** Remove the settings snapshot and catch-up modes of the history route.
- Stop recording private replication metadata and applying its history compaction exception. Keep existing database rows and the ordinary Automation definition journal.

## Capabilities

### Modified Capabilities

- `bunny-container-operator` loses the standby profile.
- `bunny-runtime` loses the standby core and replication metadata.
- `bunny-sdk` loses the standby edge mode.
- `shared-inbox-history` loses the settings snapshot and page modes.

## Impact

Active clients keep existing HTTP, SDK and MCP contracts. Source validation uses synthetic data and fake device and Docker adapters. Installed verification belongs to the Mac deployment batch.
