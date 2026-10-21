## Why

The runtime's main navigation grows with every device and declared module page. The owner accepted the Quiet rail preview and selected its implementation in [Hub #1173](https://github.com/jimmie-potts/agent-device-hub/issues/1173), using the existing reusable cards.

## What Changes

- Show Home, Rooms, Devices and Automation in primary navigation, and Settings separately.
- Add a catalog-derived Devices directory while retaining existing brand, component, playback, module, Connections and Timeline addresses.
- Place connection/operator information, Places and sign-out in Settings, with ended-session recovery still immediately reachable; link Timeline from Home.
- Ship the runtime's accepted rounded glass presentation in light and dark appearance through semantic tokens, preserving fixed attention meanings and existing card behavior.
- Preserve Home widgets, saved selections, browser history, capability guards and retained command attempts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: consolidated shell, catalog-derived directory, Settings and responsive glass presentation without changing controls or observation truth.
- `shared-places-navigation`: the current runtime's unchanged direct Places links move into its globally reachable Settings destination; retained viewers and legacy applications keep their existing presentation.

## Impact

`apps/runtime/dashboard` routes, presentation and browser consumers; the runtime dashboard and UI style guides; owning validation commands and CI browser entry. Existing module frontend entries and core-owned layouts remain authoritative. No dependency, API, SDK message, database, module writer, authentication or cross-repository contract changes are planned. Established-target installation and passive browser readback follow the owning runtime procedure; physical device tests and actual phone qualification remain separate.
