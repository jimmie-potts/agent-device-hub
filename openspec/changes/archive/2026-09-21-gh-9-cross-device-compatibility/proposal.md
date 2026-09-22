## Why

[Hub #9](https://github.com/jimmie-potts/agent-device-hub/issues/9) needs a bounded check that the selected standalone Linux/WSL software works together. Existing component tests do not provide one concise cross-device compatibility result.

## What Changes

- Add synthetic lifecycle and command checks against the hub, dashboard and pinned owning consumer code with fake physical boundaries.
- Record one tested source combination and reuse existing detailed contract, MCP and migration evidence.
- Document remaining performance-report and installed/physical evidence separately.

## Capabilities

### New Capabilities

None. This change adds verification tooling for existing requirements.

### Modified Capabilities

None. `skip_specs: true` applies because no product behavior or wire contract changes.

## Impact

Hub verification scripts, focused tests and development/work-guide documentation. Reuse the existing lifecycle, controller, Nanoleaf integration-settings and Pixoo monitor contracts. No controller source, installation, live state, physical transport or production UI changes.
