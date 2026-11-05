## Why

The owner is retiring the ONN device. [#1464](https://github.com/jimmie-potts/agent-device-hub/issues/1464) owns hibernation so unavailable hardware no longer creates runtime, UI or verification obligations.

## What Changes

- Hibernate ONN registration, controls, observations, history UI and dedicated default checks using the existing dormant-module pattern.
- Preserve dormant source, private stores, schemas, backup compatibility and private command identities.
- Retain shared keyboard, accessibility and reconnect checks. Reconcile tracker obligations and link installed deactivation through #1465.

## Capabilities

### New Capabilities

### Modified Capabilities

- `onn-controls`: controls are dormant until a new owner decision.
- `onn-title-history`: collection and reads are dormant; existing data remains private and preserved.
- `onn-history-visuals`: ONN pages and widgets are dormant.
- `bunny-runtime`: the shipped registry excludes ONN while retained storage stays compatible.

## Impact

ONN package, runtime/dashboard integration, npm workspace/build, CI selection, verification catalogs, active guides and capability specs. No wire-format changes or data migration. Installed deactivation is owned by #1465 and requires the established batch procedure.
