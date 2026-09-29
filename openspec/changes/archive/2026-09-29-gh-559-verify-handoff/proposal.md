## Why

[Hub #559](https://github.com/jimmie-potts/agent-device-hub/issues/559) records an unbuilt wrapper crash and proof paths that the owner could not open from chat. The owner selected read-only HTTP proof links on the preview origin, with attachments where the client supports them.

## What Changes

- Report a missing core build as one JSON `unavailable` result and exit 3.
- Add an opt-in app-verify adapter contract for serving committed frozen proof on the existing preview listener and naming its URLs in handoff output.
- Restrict reads to passed frozen capture files, verify their recorded checksums, and retain the preview lease and stop boundary.
- Document attachment handoff and the difference between temporary URLs and retained local evidence.

## Capabilities

### New Capabilities

- `verification-proof-handoff`: wrapper failure reporting and read-only frozen proof delivery.

### Modified Capabilities

None. Installed Hub routes and configuration retain their current behavior.

## Impact

The shared app-verify adapter API gains a resolved proof directory and optional proof-serving declaration/helper in version 1.2.0; receipt schema `app-verification/1` is unchanged. Existing 1.1 adapters remain valid and keep their current cards unless they opt in. Hub verification launchers attach the helper to the real Hub listener through an in-process extension; installed CLI configuration cannot enable it. No external consumer pins, installations, devices or release assets change in this delivery.
