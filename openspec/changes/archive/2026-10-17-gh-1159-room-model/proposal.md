## Why

[Hub #1159](https://github.com/jimmie-potts/agent-device-hub/issues/1159) lets the owner select configured lights from a private 3D room model while retaining B.U.N.N.Y.'s existing lighting controls and state owners. A conversation preview does not provide runtime authentication, private asset ownership or live device evidence.

## What Changes

- Add bounded core-owned reads of manually prepared private model metadata and geometry.
- Add a 3D room view to the existing Rooms workspace, with separate fixture selection and an existing individual LightCard.
- Resolve stable device/owner bindings against current core room membership and SDK observations; preserve missing, unbound and stale states.
- Keep original GLBs, calibration, geometry and real bindings outside source and build artifacts; use synthetic fixtures in tests.

## Capabilities

### New Capabilities

- `room-models`: authenticated private model reads, selectable fixture bindings, existing guarded controls and truthful status.

### Modified Capabilities

`bunny-runtime`: align health scenarios with the core content declaration and the host's supported module API 1.3. Existing lighting composition and command semantics remain in force.

## Impact

Changes affect `apps/runtime/src/core`, the React runtime dashboard and its browser/scenario checks. Existing module content API 1.3 carries JSON; no new transport, dependency, device writer, shared event family or stored database format is added. ADR 0011 governs private files and ADR 0012 governs reads, diagnostics and reused actions. Source, installed/client and physical acceptance remain separate under the linked issue.
