## Why

The established `apps/runtime` installation has accepted fresh setup but no
qualified routine upgrade and recovery path. [#1037](https://github.com/jimmie-potts/agent-device-hub/issues/1037)
is therefore a required supporting dependency of ONN installed acceptance
[#1044](https://github.com/jimmie-potts/agent-device-hub/issues/1044).

## What Changes

- Document an owning manual upgrade/recovery procedure for the established
  `bunny-runtime.service`, separate from fresh setup and legacy manual return.
- Bind the operator's plan to the reviewed candidate, verified previous bytes,
  fixed installation, configuration, state owners and compatible recovery.
  Add only the preflight, integrity and private receipt checks needed to guard
  those explicit manual steps; no automatic recovery engine is selected.
- Qualify synthetic upgrade, latest-state recovery and re-upgrade through the
  production stores, with no device-command replay. Prove incompatible or unknown
  recovery refuses before stopping an owner or changing state.
- Reuse the shared install receipt and release-identity contract. Verify the
  exact running revision, health, current state preservation and private receipt
  on the established installation under its applicable authority.
- Link the owning procedure from root instructions and SDLC with its explicit
  qualification gate, coordinating those small edits with concurrent documentation
  delivery. Source integration precedes the separately authorized installed
  qualification; routine use remains gated until that acceptance is recorded.

## Capabilities

### New Capabilities

- `bunny-runtime-upgrades`: repeatable upgrade and recovery of the established
  TypeScript runtime, including exact plans, refusals, preserved latest state,
  running identity and truthful private operation evidence.

### Modified Capabilities

- `runtime-install-contract`: add the current runtime's explicit successor
  receipt mapping and owned paths, including one-time service-path adoption.
  Routine switching preserves the existing trust, recovery and receipt gates.

## Impact

The owning runtime setup guide, narrowly necessary runtime installation checks
and their synthetic verification, plus small root instruction/SDLC links and
applicable validation registration. Reuse contracts 1.2.0's
[install contract](../../../docs/install-contract.md), SDK stores and the
current runtime verification facilities. The retained Hub installer targets a
different service and is not the execution path.

One coordinator owns supporting source/tracker changes and the single runtime
upgrade. No new host, scheduler, discovery, fleet manager, data migration,
transfer, legacy retirement, automatic fallback, physical command or
hook change is introduced. One-time service-path adoption is separately planned
and authorized before installed execution. Personal stores, credentials, source observations
and raw receipts remain private. Source and synthetic evidence do not establish
installed, actual-client or physical acceptance.
