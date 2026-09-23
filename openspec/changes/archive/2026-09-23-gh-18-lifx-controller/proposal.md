## Why

[Hub #18](https://github.com/jimmie-potts/agent-device-hub/issues/18) needs a configured-target LIFX controller after [qualification #17](https://github.com/jimmie-potts/agent-device-hub/issues/17#issuecomment-5801713572). The existing directory contains no executable controller.

## What Changes

- Add a private TypeScript workspace using direct UDP, with injected fake transport for source tests.
- Implement controller v1 power/brightness and a versioned LIFX color/temperature profile, serialized per bulb with bounded retries, replay and cancellation.
- Expose fresh read observations and independent per-bulb batch results; acknowledgments remain transmission evidence only.
- Add build/type/test CI checks and update package/architecture guides. No installation, discovery, bulb traffic, UI or shared-state policy.

## Capabilities

### New Capabilities

- `lifx-controller`: configured LAN targets, capabilities, queue and observation semantics.

### Modified Capabilities

None. [Controller contract v1](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/controller-contract.md) remains unchanged; Pixoo and Nanoleaf contracts and writers are untouched.

## Impact

`controllers/lifx`, root workspace/build commands and lockfile, Depot CI, development and ownership documentation. No new runtime dependency besides the existing device-contracts workspace. Source checks use synthetic addresses and fake packets only.
