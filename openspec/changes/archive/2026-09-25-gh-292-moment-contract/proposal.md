## Why

[Hub #292](https://github.com/jimmie-potts/agent-device-hub/issues/292): [ADR 0006](../../../docs/decisions/0006-hub-moments-and-interludes.md) has the hub decide coordinated moments and has each device guarantee their playback. Controller contract 1.0 is a closed command set, so Nanoleaf needed its own `animation.play` extension ([codex-nanoleaf #92](https://github.com/jimmie-potts/codex-nanoleaf/issues/92)). Unless one shared, typed moment command exists, every device would grow such an extension and the hub would need device-specific code. The owner approved the contract decisions on 2026-09-25; they are recorded in the issue.

## What Changes

- API 1.1, an opt-in minor version:
  - a `moment` command: moment ID, mood, optional palette, duration, `event` or `flourish` priority class, whether it may cover status presentation, and a start time in the receiving controller's own monotonic clock;
  - a required `moments` capability that declares moods, which must include the core `celebrate`, `setback` and `reminder`, a duration limit and whether status can be covered;
  - 1.1 receipts with the failure codes `moment-duplicate`, `moment-missed` and `moment-blocked`;
  - 1.1 snapshots and feeds with `state.moment`, which holds the current moment and the last one that ended, with its reason.
- Compatible negotiation:
  - A 1.1 controller accepts 1.0 and 1.1 envelopes on one ticket sequence.
  - A 1.0-only controller rejects 1.1 envelopes before admission.
  - A 1.1 controller serves 1.0 readers a downgraded snapshot without moment content.
  - An accepted moment does not advance the configuration revision.
- Pure reference functions in TypeScript and Python:
  - moment precedence, timing, duplicates and the return to the current base;
  - the 1.0 view of a 1.1 snapshot;
  - read version negotiation with a 1.0 default;
  - 1.1 admission.
- The shared corpus grows from 220 to 326 cases. The 220 existing cases are unchanged.
- The artifact becomes `@jimmie-potts/device-contracts` 1.1.0:
  - In-repo workspace pins move to 1.1.0 with no behavior change.
  - The hub moves to 0.3.6 (one step above #318's 0.3.5) because its archive now bundles contracts 1.1.0.
  - The Device MCP 1.0.0 archive keeps bundling the released contracts 1.0.0.
- Nothing is **BREAKING**: the 1.0 definitions, the 1.0 validators and the 1.0 admission behavior are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `controller-contracts`:
  - adds moment command, capability, precedence, timing and evidence requirements;
  - adds compatible 1.1 negotiation;
  - extends portable conformance to the 1.1 cases.

## Impact

- **Contract package:** schema, fixtures, the TypeScript/Python reference, tests and the package version.
- **Documentation and planning:** `docs/controller-contract.md`, `docs/development.md` and this change.
- **Consumer pins and packaging:** the pins in `apps/hub`, `apps/local-controllers`, `packages/mcp`, `controllers/tidbyt` and `controllers/lifx`, the lockfile, and the contract, MCP and hub packaging scripts.
- **Unchanged:** controller behavior, hub routes and MCP tools.
- **After merge:** the `controller-contracts-v1.1.0` release is published.
- **Deferred:**
  - Device adoption belongs to Nanoleaf [#158](https://github.com/jimmie-potts/codex-nanoleaf/issues/158) and Pixoo [#92](https://github.com/jimmie-potts/divoom-app-upgrade/issues/92).
  - Hub sending belongs to #293-#298.
  - The Tidbyt and LIFX hosts stay on 1.0.

This is source-only: no installation or device operation.
