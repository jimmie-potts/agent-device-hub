## Why

The Mac-local browser profile refuses every module section, so it can run only
the core. On 2026-10-23 the owner decided to lift that temporary rule generally
for modules that control no device, before the music-history module needs it
([Hub #1202](https://github.com/jimmie-potts/agent-device-hub/issues/1202)).

## What Changes

- The host-local profile admits a configuration section for a shipped module
  that declares no device simulation. It still refuses a section for a module
  that declares one, a section for an unknown module and a section with a
  `secrets` member.
- With device control disabled, the host-local profile starts the core and each
  admitted module that has a section, in shipped order. A module whose accepted
  configuration names a device refuses startup.
- The provisioning helper, the shipped list, static registration, the loopback
  binding, Host and Origin checks, empty client credentials, manual restart
  policy and private volumes do not change. The isolated and native profiles do
  not change either.
- The container guide records the admitted modules and the owner's manual
  private configuration edit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-container-operator`: the trusted-local browser profile admits
  non-device module sections.

## Impact

`deploy/container/entrypoint.mjs`, its tests and `docs/bunny-container.md`.
No new API, message format, credential, client grant, host, ingress, hook,
migration, storage format or device authority. Enabling device modules on the
Mac stays with [Hub #568](https://github.com/jimmie-potts/agent-device-hub/issues/568).
