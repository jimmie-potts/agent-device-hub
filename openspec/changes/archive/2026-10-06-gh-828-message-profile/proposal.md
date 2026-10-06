## Why

[Hub #828](https://github.com/jimmie-potts/agent-device-hub/issues/828), part of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): every part of B.U.N.N.Y. must validate its messages against one versioned contract before the parallel module lanes start. Today the components use six or more error shapes and several message formats. The 2026-10-06 plan revision also changed the platform design, so ADR 0012 needs an amendment: one TypeScript runtime, an in-process bus, SSE and HTTP for remote parts, no broker, and one offline cutover.

## What Changes

- **Profile 2.0 envelope.** One CloudEvents 1.0 structured JSON envelope for state events, removal events, occurrence events, commands, replies, completed outcomes, sync requests and `sync.completed`. It has required `subject` and `traceparent`, an absolute `dataschema` URI and `kind`. Commands and sync requests require `expiresat`. The `type` suffix must match the kind, and a message may be at most 256 KiB.
- **Building blocks.** Shared definitions for identifiers, `<name>AtMs` instants, revisions, the `{epoch, sequence}` ticket, ordering, tagged unknown values, kebab-case enum values, entity references and the error body.
- **Error body and registry.** One `{"error":{code,retryable,...}}` body and a registry of 17 codes. Each code says whether a retry can help. 1.x codes are not mapped, because 1.x retires at the cutover.
- **Validator.** `@jimmie-potts/event-contracts/v2` exports `MessageValidator`, which lets modules register payload schemas built from the blocks. It also exports `errorBody` and `compareDelivery`.
- **ADR 0012 amendment.** It records the revised runtime and transport, per-module storage and outboxes, sync from the owner, failure containment, plug-and-play module rules, TypeScript only, and one offline cutover with downtime accepted.

## Capabilities

### New Capabilities
- `bunny-message-profile`: the profile 2.0 envelope, building blocks, error registry and module schema registration.

### Modified Capabilities
None. Profile 1.0 (`shared-event-contract`) stays unchanged until the retirement story removes it.

## Impact

- **Source:**
  - `packages/event-contracts/schemas/v2/`, `src/v2/`, `fixtures/v2/` and `tests/v2.test.mjs`;
  - the package `./v2` export, and its tsconfig, which now extends the strict base;
  - the `strict` lint globs.
- **Docs:** ADR 0012, the package README and `docs/development.md`.
- **Nothing else:** no runtime, Hub, controller or device change. Delivery target: source-only.

**No design.md.** ADR 0012, amended in this change, records the design decisions and trade-offs. The change adds schemas and a pure validator with no runtime, storage, migration, timing or privacy behavior.
