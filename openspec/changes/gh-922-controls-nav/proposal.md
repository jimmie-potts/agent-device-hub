## Why

[Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922) needs the remaining general controls and module navigation to make the runtime dashboard usable. The shell, session labels, action transport and operation records already exist.

## What Changes

- Sync device records from every declared owner, plus playback and tracked operations.
- Restore capability-gated general control cards with guarded one-shot actions and distinct requested, accepted and completed states.
- Keep refusal, failed and uncertain evidence visible; recover without replay.
- Open declared module pages inside the shell and show the running build on Connections.
- Document the existing disposable preview command and exercise changed journeys.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: device controls, live record ownership, module navigation and build identity.
- `bunny-runtime`: authenticated build read and same-origin module-page embedding.

## Impact

The runtime dashboard, its focused browser/unit checks and dashboard-owned catalog scenarios change. The authenticated gateway gains only the bounded page/build support this shell needs. Existing device contracts and core tracker ownership remain intact. No new preview abstraction, installation, data migration, real device commands or later feature page is included.
