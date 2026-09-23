## Why

[Hub #185](https://github.com/jimmie-potts/agent-device-hub/issues/185) addresses an approval marker that cannot be matched to a later tool result because the current Codex permission hook lacks a request ID. This leaves consumers displaying blocked state indefinitely; the user chose an explicit, auditable recovery action that keeps uncertainty visible.

## What Changes

- Add a revision-guarded owner operation to retire exactly one uncertain unknown-ID approval for an exact session and turn.
- Expose that operation to authorized control clients through monitor HTTP and MCP, with request replay protection.
- Record the recovery in bounded diagnostics while preserving unrelated activity, notices and evidence.
- Publish new private agent-state and Hub package versions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: explicit recovery of one uncertain uncorrelated approval.
- `standalone-hub-host`: authenticated, replay-safe control command for recovery.
- `standalone-hub-mcp`: recovery tool with exact identity, turn and revision.

## Impact

Shared agent-state and standalone Hub source, schemas, package manifests, HTTP and MCP tests and owning guides. [Nanoleaf #72](https://github.com/jimmie-potts/codex-nanoleaf/issues/72) consumes the later owner revision. The operation does not approve or deny a provider permission, install the host or contact a device.
