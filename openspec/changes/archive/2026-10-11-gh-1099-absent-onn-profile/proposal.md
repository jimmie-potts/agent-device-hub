## Why

[#1099](https://github.com/jimmie-potts/agent-device-hub/issues/1099) repairs a routine-upgrade qualification gap: current source ships ONN, but the existing checker refuses its unconfigured health row. This blocks the approved Sony correction's installed acceptance under #1054.

## What Changes

- Recognize ONN only as an unconfigured, no-retained-state, refused/not-found and unhealthy module.
- Apply that bounded exception in the existing shared preflight/post-start health guard.
- Preserve configured/retained ONN, unknown-module and unhealthy/drift refusals, and legacy seven-owner admission certificates.
- Add focused admission/refusal regressions and update the owning procedure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: define the bounded absent-ONN health exception without expanding configured or retained owner qualification.

## Impact

Only the operator health guard, its regression tests, conservative state-reader tests and owning procedure/specification change. No module, dependency, message, receipt, diagnostic schema or installation change is selected. ONN source remains with its coordinator; BB-8's broader profile follows this reviewed repair. Source delivery does not establish upgrade admission, installation or physical artwork acceptance.
