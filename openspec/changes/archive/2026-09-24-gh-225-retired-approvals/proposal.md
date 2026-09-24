## Why

[Hub #225](https://github.com/jimmie-potts/agent-device-hub/issues/225): Codex's permission hook sends no request ID, and the owner keeps attention across turns. An approval marker from an earlier turn therefore never resolves, and a task stays red even while it works on later turns. The installed owner held 10 such markers across 7 wall tasks, and 7 of the markers were on turns the owner had already retired.

## What Changes

- Retiring a turn forgets that turn's approvals without a request ID. A late approval of that kind for a retired turn is not retained.
- Startup settles a stored backlog in one revision.
- Markers on the current turn or on never-selected turns, approvals with a request ID, questions, input requests and explicit recovery are unchanged.
- Publish new private agent-state and Hub package versions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: retired-turn approvals without a request ID, and a best-effort selection exception.

## Impact

Shared agent-state reducer, owner startup and maintenance, tests, the agent-state guide and package manifests. Consumers need no change. Nanoleaf already clears frozen red when the owner removes an approval on the same turn (codex-nanoleaf #72), and a new turn supplies current evidence.
