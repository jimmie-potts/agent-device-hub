## Why

[Issue #1393](https://github.com/jimmie-potts/agent-device-hub/issues/1393) repairs the qualification producer's image identity for the established Mac/containerd consumer. The producer currently records its local configuration digest, while the selected Mac loads the saved OCI manifest by its distinct digest. Actual authenticated consumption refused before installation. Existing receipts and that failed intake remain unchanged.

## What Changes

- Derive new image metadata from the exact saved single OCI manifest after packaged verification.
- Verify manifest and configuration hashes, sizes, platform, source, user and production layer identity against the tested production image.
- Stream the archive with finite bounds and refuse malformed, ambiguous or mismatched graphs.
- Preserve producer-local build/test/save handles, all strict consumers and the existing receipt fields.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-release-qualification`: identify new qualified artifacts by the verified saved OCI manifest for the selected Mac lane.

## Impact

Changes are confined to the release producer, focused archive fixtures, owning development instructions and this capability. No dependency, registry, Docker setting, consumer API, receipt schema, runtime behavior or installed state changes. ADR 0012's existing refusal and failed/incomplete outcomes apply. No cross-repository contract changes are required. Hosted CI, new matching qualification and real Mac consumption remain issue-owned acceptance after source delivery.
