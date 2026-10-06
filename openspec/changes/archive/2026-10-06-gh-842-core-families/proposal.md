## Why

[Hub #842](https://github.com/jimmie-potts/agent-device-hub/issues/842), part of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), wave 2: the runtime's modules and remote parts need one normalized shape for the core's facts before the core moves into the runtime (#831) and the modules consume it (#832, #843, #844). Profile 2.0 (#828) defined the envelope, the building blocks, the `removal` kind and `sync.completed` membership, but no core payloads. The Nanoleaf port (#26) also hands this story the snapshot schema check, including the refusal of cross-source parentage.

## What Changes

- **Core payload families** in `packages/event-contracts/schemas/v2/families/`, each built from the shared blocks and registered through `MessageValidator.register`:
  - state: `session`, `mode`, `inbox-item` and `playback`, each the full record of one entity;
  - occurrence: `lifecycle` (a hook observation for the core), `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` and `moment-ended`;
  - command: `mode-set` and `moment-play`, naming no device. Their replies and outcomes use the profile's payloads.
- **Payload checks.** `MessageValidator.register` takes an optional check for rules a schema cannot state. The core families use it to refuse:
  - cross-source parentage and a self parent;
  - ordering under another authority;
  - an entity ID or subject that is not the identity key;
  - repeated notices or unavailable dimensions;
  - a moment start more than 60 s ahead.
- **Removal, expiry and sync.** Fixtures and a reference consumer show three cases with the existing `removal` kind and `sync.completed` membership: an expired session, a retired subtree and a deleted inbox item. They also show a sync that drops an entity the consumer still held.
- **1.x mapping.** `packages/event-contracts/MAPPING.md` covers every field of the agent-state session record and snapshot, the lifecycle observation and the controller receipt. It also covers the moment command and the playback snapshot. A test checks that the table names every 1.x schema field. It converts the 1.x corpora and drives a real agent-state owner's expiry and retirement through the table's rules.
- The package exports the families as `@jimmie-potts/event-contracts/v2/families`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-message-profile`: adds the core payload families, payload checks, removal and sync membership rules and the 1.x field mapping. Module payload schema registration gains the optional check. Completed outcomes state that evidence `none` means no evidence that anything reached the device (coordinator decision, 2026-10-06).

## Impact

- **Source:**
  - `packages/event-contracts/schemas/v2/families/`;
  - `src/v2/families.ts`, plus the `register` check in `src/v2/index.ts`;
  - `fixtures/v2/families.json`;
  - `tests/families.test.mjs`, `tests/mapping.test.mjs` and `tests/consumer.mjs`;
  - the `./v2/families` export.
- **Docs:** the package README, `MAPPING.md`, one sentence in `docs/architecture.md`, and ADR 0012's wording for outcome evidence `none`.
- **Nothing else:** no runtime, Hub, controller, device or 1.x contract change. Delivery target: source-only.
- `design.md` records the decisions that change a 1.x meaning or choose a new shape, and the coordinator's decisions on them (2026-10-06).
