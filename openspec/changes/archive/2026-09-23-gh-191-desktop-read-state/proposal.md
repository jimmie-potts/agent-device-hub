## Why

[Hub #191](https://github.com/jimmie-potts/agent-device-hub/issues/191) restores a legacy Nanoleaf behavior that shared mode lost: when the user reads a finished Codex Desktop task in Codex, consumers that honor read evidence stop showing it as unread. No producer emits `read.observed` today, so every shared session reports `read: unknown` and completion notices stay unread until acknowledged.

## What Changes

- Add an optional, read-only Codex Desktop read-state reader to the standalone Hub. It watches Desktop's unread marker in the configured Codex home and ingests `read.observed` for top-level sessions from the configured Desktop source.
- Keep read evidence separate from observation freshness in the shared owner. A read observation no longer refreshes observation age, clears restart uncertainty or creates a session.
- Publish new private agent-state and Hub package versions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: read evidence does not refresh freshness or admit a session.
- `standalone-hub-host`: optional Codex Desktop read evidence from a configured Codex home.

## Impact

Shared agent-state and standalone Hub source, package manifests, tests and owning guides. Nanoleaf already hides its unread indicator for `read: read`. The reader never writes Codex state, never exports marker contents or paths, and does not install the Hub, change hooks or contact a device. [Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218) will reuse the configured Codex home.
