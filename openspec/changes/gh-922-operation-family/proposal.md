## Why

[Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922), slice 2a: the dashboard's device cards must show a general control requested, accepted and completed, and never a transport acknowledgment as a physical result. The core tracks every action (#782), but its rows live in the core store: nothing publishes them, and a browser can read only what it syncs. The cards also need each device owner's name, which health lists in `serves` and a browser cannot read. This slice adds both, before the cards (slice 2b) consume them.

## What Changes

- **The `operation` family.** A core state family: the latest state of each tracked action, keyed by `operationEntityId(requestId)`, with its status, result, evidence, error and reply, and no command payload.
- **The core publishes it.** A core part saves and publishes each action's record from the tracker's change, in the same transaction, and the core serves the family through its sync. The family keeps the latest 256 records, removing the oldest settled one as `retired` and never a pending one.
- **`serves` in `/api/v2/modules`.** Each module's families as health lists them.
- **Checks.** A runtime test of the records, the core's conformance run over `operation`, contract fixtures and a tier 1 scenario.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: the core families gain `operation`, with its record rules.
- `bunny-runtime`: the core publishes its operation records; the module list names what each module serves.

## Impact

- **Code:** `packages/event-contracts` (`schemas/v2/families/operation.schema.json`, `src/v2/families.ts`); `apps/runtime` (`src/core/operation-records.ts`, `core.ts`, `index.ts`, `gateway/gateway.ts`).
- **Tests:** `fixtures/v2/families.json`; `apps/runtime/tests/operation-records.test.ts`, the core's conformance run, `gateway.test.ts` and `process.test.ts` expectations, and the `operation-records` catalog scenario.
- **Docs:** the event-contracts README, the runtime README and the SDK README's owners paragraph.
- **Unchanged:** the tracker's rows and state machine, the dispatcher, the SDK, the device modules, coordinator-owned files and the released 1.x contracts.
- **Delivery:** source-only.
