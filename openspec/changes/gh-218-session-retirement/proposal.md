## Why

[Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218) requires an ended Codex Desktop session and its known descendants to leave monitoring promptly. Today the owner retains them until evidence expiry, and a consumer cannot distinguish a recreated record from the old record if it misses the removal.

## What Changes

- Retire Codex Desktop records and their known descendants through one atomic owner replacement and revision.
- Retain bounded, durable identity/order evidence to reject recognizable delayed events; admit eligible new work with fresh monitoring defaults.
- Add an opt-in snapshot 1.1 generation field, retaining snapshot 1.0 for existing readers. Upgrade affected consumer reconciliation only where focused checks demonstrate a gap.
- **BREAKING**: durable format 2.0 adds retirement evidence and record generations. The new owner imports format 1.0 without resetting evidence clocks; older owners cannot read new exports. Installation and rollback require the documented owner handoff.
- Check read-only archive filename evidence only on admission, using the existing configured Codex home. Retirement does not require archive access.
- Update lifecycle/state contracts, compatibility evidence and the work guide. Keep installed-client and visible-device acceptance separate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: atomic Desktop retirement, bounded delayed-event safeguards, fresh record generations and export compatibility.
- `agent-lifecycle-contract`: distinguish Desktop retirement from other runtime-end policy without changing lifecycle envelopes.
- `unified-dashboard`: discard retired session drafts when a generation changes, preserving ordinary reconnect drafts.
- `standalone-hub-host`: optional archive admission evidence and explicit snapshot-version selection.

## Impact

The shared state package, Hub host, TypeScript/Python schema consumers and focused dashboard/Tidbyt checks are affected. Nanoleaf's [shared-input adapter](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/bridge/shared_input.py) needs generation-aware reconciliation. Pixoo's owning-source compatibility check will establish whether it needs a change. Consumer companion work remains scoped to this issue's required compatibility; device writers, modes and unrelated effects retain their owners.

Complexity is medium with a coupled compatibility boundary; uncertainty is medium until the consumer checks pass; impact is medium because only monitoring state is forgotten. Source readiness depends on fixed contract scenarios and focused red/green checks. Installation, real clients and physical acceptance require separate authorization and remain issue-completion gates.
