## Context

See proposal.md, "Why". The schema's criteria for a design apply: the change adds a core family that the dashboard (#922) and the inbox (#923) consume and publishes it from the tracker's transactions. ADR 0012's "Ownership and publication", "High-impact messages", "Consumers and recovery" and "Errors, effects and outcomes" govern it; #782's design sets the tracker and its extension point.

## Goals / Non-Goals

**Goals:** each tracked action's latest state as a synced family, published with the tracker's change; pending-preserving projection retention; `serves` in the module list.

**Non-Goals:** the device cards and controls (slice 2b), the inbox's items (#923), history's read API (#923), changes to the tracker's state machine or rows.

## Decisions

- **Existing tracked hook.** The family is the core's own first `CorePart`: it derives each record from `tracked`, the tracker's change, in that change's transaction, and publishes through the core's outbox. The tracker stays as it is, and #923's parts get the same hook.
- **Latest value, keyed by request.** One entity per request ID, `operationEntityId(requestId)`, since a request ID may hold characters a routing key does not. The validator checks the derivation, as it checks a session's.
- **Action identity.** The record names the family and target without the command's data: a display needs the action's state, and the payload stays in the tracker for #923's "send again".
- **A bounded family.** The tracker and history keep every action. After every tracked change, including settlement and a late outcome for a retired record, the family removes the oldest settled projections by `sent_at_ms, id` until at most 256 remain or only pending rows remain. Pending rows survive even above 256; settlement and deadlines restore the bound as they permit. Retirement never deletes tracker/history rows.
- **Projection table.** The part keeps its records in `operation_records` beside the tracker's rows, so what it published and what it removes are its own.
- **`serves` from the bus.** The module list takes `bus.served(source)`, as health does, so the two never disagree.

### Boundaries and outcomes

- **Entry points and hand-offs.** The tracker's changes (#782) into the part; the core's sync and outbox out to every reader; `GET /api/v2/families/operation` and the SDK edge for remote parts; the inbox (#923) by request ID.
- **Refusals and outcomes.** A record mirrors the tracker's outcome semantics: `rejected` and `expired` are failed with evidence `none`, `uncertain` means the fate is unknown, and an accepted reply is never evidence of an effect. A full disk refuses the tracker's transaction, and with it the record: nothing is published for work that did not commit.
- **Codes and retries.** Registry codes only, from the tracker's rows. Nothing retries; the outbox republishes a committed record after a crash, with its stored `id`.
- **Records and traces.** No new log records: the tracker's `command.*` records and the outbox's own cover the steps. State and removal messages join the incoming outcome's trace when present, and the stored action's trace for dispatch, reply or deadline changes. Republication keeps the stored message context.
- **Fault cases.** A crash between commit and publish (the outbox republishes), a restart with a pending action (its deadline makes it uncertain), a full disk (no record without the change), more actions than the bound (the oldest settled ones retired).

## Risks / Trade-offs

- A display that was away misses a record that was retired meanwhile; its sync shows the retained latest records, and the tracker and history keep everything.
- More than 256 pending actions can exceed the projection limit. Each settlement/deadline prunes eligible rows; an unconditional 256-row cap would lose pending records and is not promised.
