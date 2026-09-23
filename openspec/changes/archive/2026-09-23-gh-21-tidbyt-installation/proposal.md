## Why

[Tidbyt installation #21](https://github.com/jimmie-potts/agent-device-hub/issues/21) needs a runnable connection between the installed hub feed and the delivered status publisher. The current package exposes only an in-process library.

## What Changes

- Add an owner-invoked Linux runner with private configuration and a bounded, read-only hub feed adapter.
- Bind reads to the configured shared owner and serialize all display writes through the existing Tidbyt controller.
- Prevent concurrent runner processes for the same cloud device with an OS-released local lease.
- Document startup, shutdown, restoration and the separate real-client/display acceptance sequence.

## Capabilities

### New Capabilities

- `tidbyt-status-installation`: Private runner configuration, selected-owner reads, single writer and shutdown.

### Modified Capabilities

None. Layout, cadence, queue and background rotation retain the released tidbyt-agent-status and tidbyt-cloud-controller contracts.

## Impact

Changes stay in controllers/tidbyt and its development/specification documentation. The hub API, provider hooks, state owner and existing controller services remain unchanged. No new HTTP surface or shared wire profile is introduced. Source tests use fakes; the issue remains open until installed-client and human display acceptance are recorded.
