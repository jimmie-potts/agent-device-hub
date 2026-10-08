## Why

[Hub #935](https://github.com/jimmie-potts/agent-device-hub/issues/935) needs an
ordered cutover plan before its executor can stop writers or migrate stores.
The existing Hub planner combines installed-state discovery with a single-service
upgrade contract; the runtime needs a testable plan from explicit facts while
its receipt and recovery contract is resolved.

## What Changes

- Add a pure runtime preparation planner that accepts explicit source, path,
  writer, store, converter and size facts. It discovers no installed state.
- Validate complete selected-store and writer coverage, source/destination
  separation, migration order and available space; return named missing inputs
  instead of inventing installed facts or successful conversions.
- Bind the normalized plan to a digest and reject changed approval inputs.
  A preparation plan is not permission or proof that the cutover can execute.
- Document and test the planner with synthetic facts. Preserve the existing Hub
  command, install-receipt/1.0 and latest-durable-state recovery unchanged.

This is the first source slice of #935. It adds no CLI, filesystem discovery,
backup or migration execution, receipt writer, service control, hook change,
activation or installation. Those remain later #935 work, and
[the owner-present #840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840)
retains installation and device acceptance. The pending receipt-contract decision
does not become a default in this slice.

## Capabilities

### New Capabilities

- `runtime-cutover-planning`: Prepare a digest-bound, ordered runtime cutover
  plan from explicit facts, with input and resource refusals and no effects.

### Modified Capabilities

None. The existing `runtime-install-contract` remains authoritative for the
legacy installer; this slice produces no receipt under that contract.

## Impact

New runtime-owned planner code and pure tests, its README check notes and one
OpenSpec capability. The existing runtime build/typecheck and core CI test glob
cover the new files. No dependency, workspace, lockfile, CI, device protocol,
module behavior or cross-repository source changes are needed. Private caller
facts stay local under ADR 0011; published fixtures contain synthetic values.
