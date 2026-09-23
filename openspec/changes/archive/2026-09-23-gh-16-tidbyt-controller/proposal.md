## Why

[Hub #16](https://github.com/jimmie-potts/agent-device-hub/issues/16) needs a Tidbyt controller that can be tested with fakes and that uses the official Tidbyt cloud. The push API qualification recorded on [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16#issuecomment-5789545093) confirmed three things: a background push with a named installation joins the display rotation without interrupting the current app, `DELETE` removes the installation, and invalid credentials return unusual 401/500 bodies. `controllers/tidbyt` holds only documentation so far. The shared [controller contract v1](../../../docs/controller-contract.md) from [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) has no frame command. Pixoo and Nanoleaf already carry device-specific operations in their own integration profiles.

## What Changes

- Add the `@jimmie-potts/tidbyt-controller` npm workspace package under `controllers/tidbyt`. It is an in-process TypeScript library with no network listener, service or installer.
- Add a pure 64×32 rendering boundary. It validates an RGB frame and encodes it as lossless WebP (VP8L) with no runtime dependency. Committed golden images are decoded independently by Pillow.
- Add a Tidbyt cloud connection. It takes an operator-configured cloud device ID, API key and installation ID, loads them from a private file outside Git, and always pushes in the background. Authentication, rate-limit, timeout and transport results are classified without replaying an ambiguous write.
- Add one serialized controller queue. It uses controller v1 request tickets, configuration revisions, generations, receipts and snapshots, together with a controller-local `tidbyt-display` profile for the frame operation. The queue covers configured-target validation, bounded admission, replay of duplicates, conflicts, cancellation by generation, rate-limit holds, authentication blocking and read-only reconnect.
- Report queued, sent, failed, uncertain and cancelled outcomes separately from cloud installation evidence and its age. Visible-device evidence remains explicitly unknown.
- Add build, type, test and Python golden-image commands to the root manifest, `docs/development.md` and the existing combined contracts/state CI jobs.

## Capabilities

### New Capabilities

- `tidbyt-cloud-controller`: fake-testable Tidbyt cloud controller with a pure 64×32 WebP renderer, a serialized display queue and honest outcome and evidence reporting.

### Modified Capabilities

None. The controller v1 wire contract, its fixtures and both reference consumers are unchanged.

## Impact

This change adds `controllers/tidbyt/{package.json,tsconfig.json,src,tests,fixtures}`, a new workspace in the root `package.json` and `package-lock.json`, build/typecheck entries, `test:tidbyt` and `test:tidbyt:python` scripts, a pinned Pillow in `requirements-contracts.txt`, two new CI steps in each contracts/state job with matching workflow tests, and updates to the Tidbyt README and development guide. It makes no contact with a device or account, and it adds no hook, service, installation or state migration. Automatic agent status (#19), installed visible acceptance (#21), Tronbyt (#23) and the firmware transition (#24) remain separate.
