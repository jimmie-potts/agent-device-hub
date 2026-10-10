## Why

[#1037](https://github.com/jimmie-potts/agent-device-hub/issues/1037) requires installed identity and health verification. A read-only check on the established installation took 20.3 seconds for one release-source pass; the complete post-start checker repeats that pass four times. Its current sixty-second ceiling prevents selecting a sufficient bound before stopping the service.

## What Changes

- Allow a post-start verification attempt of up to 180 seconds, explicitly chosen in the private request and bound into the approved plan.
- Preserve finite attempts, observation-only retries, stop limits and all source, identity, health, state and drift checks.
- Document selecting the bound from actual release-verification work before effects and replanning when it changes.
- Exercise the longer supported bound and rejection of invalid or excessive limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This operator-tool correction implements the existing `bunny-runtime-upgrades` requirements for bounded verification and refusal of changed operational choices. It changes no runtime API, install-receipt schema, storage format or product feature. The change explicitly uses `skip_specs: true` for tooling rather than inventing a new requirement.

## Impact

Only the runtime upgrade request parser, its tests and owning procedure/development notes. No dependency, manifest, lockfile, shared contract, service or hook change. Installed execution still requires a fresh qualified plan and the applicable owner approval. Source delivery alone leaves #1037 open.
