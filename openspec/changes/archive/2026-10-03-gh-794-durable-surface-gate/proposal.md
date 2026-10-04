## Why

[Hub #794](https://github.com/jimmie-potts/agent-device-hub/issues/794) narrows the Hub upgrade compatibility gate that [#718](https://github.com/jimmie-potts/agent-device-hub/pull/718) introduced. Today `durableFingerprint` hashes the whole `dist` and `schemas` of `@jimmie-potts/agent-state` and `@jimmie-potts/agent-lifecycle-contracts`. Any reducer or lifecycle change therefore refuses with `durable-implementation-unqualified`, even when stored state is unaffected. [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784) is the first such change. On 2026-10-03 the owner chose to keep its new field in memory only and to narrow the gate to the durable state surface while keeping rollback safety.

## What Changes

- Compare only the durable surface across the previous release, the target and the running installer: the files that encode, decode or accept stored bytes, plus the stored-state and frozen lifecycle schemas they apply. The design lists the files.
- Fail closed. An unclassified module or schema file in either package counts as durable, as does any other Hub module that imports `node:sqlite`. A missing required file still refuses with `durable-implementation-unavailable`.
- Extend the synthetic target-write/previous-reopen probe to cover title, project, project ID, label origin, metadata time and a known parent. A target that leaks a new field into storage then fails the probe.
- Record the specific qualification reason in the operation's evidence file for a refusal, not only for success.
- Keep refusal before stop, the reason codes, receipts, plan digests, provenance inventories, health and identity checks. Add no force flag and no stored-format migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hub-runtime-upgrades`: the "Trusted release and compatible recovery" requirement names the durable surface, its fail-closed rule and the acceptance examples.

## Impact

`apps/hub/src/install/compatibility.ts`, `apps/hub/bin/install-compatibility-probe.mjs`, one evidence line in `apps/hub/src/install/operation.ts`, the compatibility and operation tests with a shared release fixture, `apps/hub/SETUP.md` and `docs/install-contract.md`. The agent-state, lifecycle and Hub storage modules do not change, so the gate's current definition admits this release on the owner's installation. Existing Hub test and package CI jobs cover the tests; no new CI job is needed. A real stored-format migration, such as durable 2.2, still needs its own reviewed procedure.
