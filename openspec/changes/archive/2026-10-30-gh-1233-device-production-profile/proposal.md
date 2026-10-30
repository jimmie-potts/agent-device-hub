## Why

The Mac container currently refuses device modules on its browser/private profiles. [Hub #1233](https://github.com/jimmie-potts/agent-device-hub/issues/1233) supplies explicit configured-module admission before #568's fresh-state cutover.

## What Changes

- Add one production access profile using the existing private proxy, host-loopback gateway, manual operator and private volumes.
- Admit only configured shipped modules in registration order, with existing module contracts and bounded private secret references.
- Keep device control explicitly enabled only on that profile and retain existing host-local/private-proxy refusals.
- Support an explicitly selected Pixoo hosted-GIF binding without widening the gateway. Keep host dependency setup, device activation and all physical qualification in their owning work.
- Exercise fresh synthetic module startup with simulated transports and verify the installed image with device control still disabled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-container-operator`: explicit production module admission and matching operator/Compose protections.

## Impact

Container entrypoint, Compose overrides, host operator, focused tests, owning container/hosting documentation and the existing capability spec. Runtime module wire contracts and state formats remain unchanged. Source acceptance does not qualify Mac dependencies or physical targets.
