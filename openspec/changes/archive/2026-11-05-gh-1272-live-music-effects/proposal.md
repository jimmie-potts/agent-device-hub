## Why

[#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) needs deterministic music rendering that can be checked before the owner selects participation and interruption behavior. The shared #721 capture contract now supplies bounded level and broad-band measurements, allowing this source increment independently of live device admission.

## What Changes

- Add closed, frozen version-1 recipes for level glow, bass pulse, three-band spectrum, traveling waves and ambient colors.
- Add a deterministic renderer for saved Lines and NL22 geometry using the existing display encoder and payload limits.
- Add a bounded latest-feature intake using the existing profile-2 capture family, explicit clock samples, generation fences and expiry.
- Exercise numeric, geometry, version, freshness and retirement behavior with synthetic fixtures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-module`: internal music recipe, rendering and intake behavior, with no callable device integration.

## Impact

Only Nanoleaf's internal source, tests and package guide change. This increment is stacked on the #721 shared capture contracts; it adds no wire family, SDK subscription, command handler, store, device worker or installation change. Existing Nanoleaf behavior remains authoritative. Participation, start/stop outcomes, interruption and restoration remain later #1272 work under the owner decision in #40; physical timing remains #725. No cross-repository contract changes.
