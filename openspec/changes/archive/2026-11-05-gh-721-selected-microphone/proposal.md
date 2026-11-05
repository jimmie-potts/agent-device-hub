## Why

[Issue #721](https://github.com/jimmie-potts/agent-device-hub/issues/721) requires an explicitly selected microphone for live music. The current producer supports only Music.app; a connected microphone path can reuse its bounded analyzer, authenticated delivery and core-owned capture lifecycle.

## What Changes

- Support one owner-configured microphone alongside Music, selected by a bounded public alias that resolves to a private local CoreAudio device UID.
- Provide explicit local input discovery and permission-only operations. Startup, connection and permission grant never start capture.
- Read only the selected device's supported input streams, reuse the current analyzer and publish unchanged raw measurement semantics with selected-input provenance.
- Extend the capture payload families with registered `/2.1` schemas alongside unchanged `/2.0`. The upgraded core publishes one `/2.1` current-state record; bundled consumers accept both versions.
- Preserve Music capture, bounded queues and deadlines, durable responsibility, stop/disconnect fencing and truthful unavailable or uncertain results. Never select a default microphone or fall back automatically.
- Keep calibration, noise gate, sensitivity, smoothing, band emphasis and richer analysis in the remaining issue scope. This increment includes no unused conditioning helpers, light integration, installation or physical capture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-music-capture`: explicit selected microphone, separate permission setup, input provenance and native refusal/teardown behavior.
- `shared-event-contract`: additive selected-microphone schemas and one-version state production with both-version consumer acceptance.
- `bunny-runtime`: current input capability, selected-source binding and compatibility of core state and operator controls.
- `runtime-dashboard`: configured alias selection, both-version state consumption, source-bound meters and accessible bounded presentation.

## Impact

Affected code is `apps/music-producer`, `packages/event-contracts`, the runtime capture owner/tracker and the capture dashboard consumer delivered by #722. The SDK transport and gateway keep their existing protocol and family grants; their tests prove the new payload versions are carried correctly. No other repository contract changes.

This change consumes #722's browser-safe `v2/music-capture-data` extraction after its coordinated stable revision. Existing producer, event, SDK, runtime, dashboard, workflow and synthetic native checks own source evidence. AVFoundation authorization and CoreAudio access are replaced in tests. Packaged identity, owner-selected microphone access and physical timing remain separate qualification work under the issue.
