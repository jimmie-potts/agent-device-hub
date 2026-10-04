## Why

The installed Hub reached its 128-session limit with 114 Claude subagent (child) records ([#807](https://github.com/jimmie-potts/agent-device-hub/issues/807)). Each record holds its slot for 24 hours after its last evidence, and a full owner rejects every new identity. New Codex Desktop tasks and Claude Code sessions were therefore dropped for about 12 hours and reached no device, including the #743 CHOMPI trial's tasks. The owner chose to fix this now as a #743 blocker by letting new root tasks displace subagent records.

## What Changes

- When the owner is full and an event would create a root session, `agent-state` retires the least recently active child record whose subtree holds no attention, together with its descendants, through the existing retirement path, and then admits the root. Each displacement adds one to the loss count.
- A new child still never makes room, roots are never displaced, and with no eligible child the root is rejected as `capacity`, as before.
- `@jimmie-potts/agent-state` becomes 3.6.0 with every exact pin moved in lockstep, and the Hub becomes 0.6.1. The durable schemas, contracts and wire formats are unchanged.

## Capabilities

### Modified Capabilities

- `agent-state-core`: bounded admission lets a new root displace an eligible child record.

## Impact

`packages/agent-state` owner admission only, plus version pins and docs (`packages/agent-state/README.md`, `apps/hub/README.md`, `docs/event-contract.md`). No storage format change, so the Hub upgrade needs no migration. Installing it is part of this delivery under standing authority.
