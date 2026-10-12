## Why

[ONN installed acceptance #1044](https://github.com/jimmie-potts/agent-device-hub/issues/1044) needs a current release containing the reader correction. That release also ships the existing companions state owner, which the upgrade profile currently refuses; bypassing the refusal or recovering with bytes that cannot reopen its data would violate the owning procedure.

## What Changes

- Extend the fixed admission profiles with complete companions coverage while preserving the existing legacy, ONN and paired BB-8 profiles and certificate schema.
- Inventory companion state without opening live databases, and require four bound compatibility phases whenever its state/configuration or selected release requires that owner.
- Require a companion-capable recovery release and ordinary running health for each selected artifact that ships this always-started owner.
- Permit only its qualified first-created durable ownership after startup; refuse unrelated ownership drift and unknown, duplicate, partial or unsafe evidence.
- Add production-store synthetic recovery/refusal tests and document the additional qualification. Feature enablement, installation and physical acceptance retain their separate authority.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: complete companion-owner coverage, compatible recovery, role-specific health and bounded first-start ownership.

## Impact

Shared runtime upgrade inputs/admission/preflight, focused qualification tests, UPGRADE and DEVELOPMENT. No companion or ONN module behavior, SDK/contracts, root manifest/lockfile, CI, device transport, collection source, installed configuration or service change is selected. [#643](https://github.com/jimmie-potts/agent-device-hub/issues/643)'s companion feature and desk acceptance remain separate; this supports the ONN release's source qualification only.
