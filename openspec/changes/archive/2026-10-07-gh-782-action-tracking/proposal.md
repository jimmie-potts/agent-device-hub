## Why

The new runtime of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) sends device commands but tracks none of them: a remote part with `control` requests any device's command directly, nothing records whether it worked, module outboxes resend every outcome at each start because nothing acknowledges them, and history is a test stand-in. [Hub #782](https://github.com/jimmie-potts/agent-device-hub/issues/782) gives the core one dispatcher that tracks every device command, moment and mode change from sent to its end, takes every outcome once, acknowledges it so modules forget it, and keeps history, under [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)'s "High-impact messages", "Errors, effects and outcomes" (with "Late and conflicting outcomes") and "Inbox and history".

## What Changes

- **One dispatcher in the core** (`apps/runtime/src/core/tracker.ts`). It records an action as sent before it sends anything, so a full disk refuses it with `unavailable` and `storage-full`; sends the command once with its kind's reply deadline; records the reply; and waits for the outcome until its kind's outcome deadline (device 5 s and 30 s, moment 5 s and 150 s, mode 5 s and 60 s). A request ID names one action, ever. Nothing is ever sent again.
- **The tracker's state machine** (`operations.ts`, pure): sent, accepted, completed; rejected and expired (failed); uncertain at a deadline; a late definitive outcome replaces uncertain, and a `succeeded` with a `failed` outcome is a conflict for a person, in either order.
- **Outcome intake and the acknowledgment.** The core takes every state, removal, occurrence and outcome into history, drops duplicates by `(source, id)` durably, refuses a reused `(source, id)` with other content as `duplicate-conflict` and keeps it for diagnosis. Once an outcome commits, the core acknowledges it with the new core family `outcome-recorded`, and acknowledges an exact duplicate again. `message.received` carries the incoming message's trace (#950 hand-off).
- **History** (`history.ts`): every removal, occurrence and outcome whole, each state change as a compact change event, never a snapshot (owner decision, 2026-10-07), and each tracked step, in the commit's transaction, with no time limit.
- **Modules forget acknowledged outcomes.** The SDK's `Outbox` follows the core's acknowledgments itself in `republish()`, accepting one only from the core's source; the kit's stand-in acknowledgment and LIFX's `acknowledgments` option are removed, and a new kit check proves each module forgets an outcome on the core's acknowledgment only. `edgeValidator(schemas)` gives a remote outbox the edge's checks.
- **Action routes.** `POST /api/v2/commands/<family>` and MCP's `core_send_command` send actions through the dispatcher. At the SDK edge a `control` grant requests only the core's operator commands directly.
- **The turn-ended `inbox-item` variant is removed** from the schema, type, check, fixtures, MAPPING.md and the synced specification (owner decision 7); a turn-ended item is refused as `invalid-message`.
- **Tiers.** The catalog sends every device command through the dispatcher (`Harness.dispatch`); the fixture core's stand-ins derive from the real tracker; disposable runs' follow proof follows dispatched actions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: the action dispatcher and tracker, outcome intake and acknowledgment, core history, action routes; the fixture module and core, the catalog and harness, the SDK edge's device commands, the core store's history rows, the extension point, the gateway's callers and routes.
- `bunny-sdk`: the outbox follows the core's acknowledgments and a remote outbox gets the edge's validator; the module test kit's acknowledgment check replaces the stand-in.
- `bunny-message-profile`: the `outcome-recorded` core family, and inbox items as operations only.

## Impact

- **Code:** `packages/event-contracts` (the `outcome-recorded` family and schema, the inbox item's schema and type, fixtures, README and MAPPING.md); `packages/sdk` (`acknowledgment.ts`, `outbox.ts`, `index.ts`, the kit, comments in `module.ts` and `remote-edge.ts`); `apps/runtime/src` (new `core/tracker.ts`, `core/operations.ts`, `core/history.ts`, `core/backoff.ts`; `core/core.ts`, `core/store.ts`, `gateway/*`, `runtime.ts`, `index.ts`); `apps/runtime/tests` and `verify`; `modules/lifx` (the option removed), comments and READMEs in `modules/playback` and `modules/lifx`.
- **Coordinator-owned files:** none changed.
- **Unchanged:** module API 1.2, the diagnostic catalog, CI workflows, the root manifest and the lockfile.
- **Delivery:** source-only, verified in disposable runs; installation is the cutover's (#840).
- **Out of scope** (owner decisions, 2026-10-07): the history read API with filters, the harness's history-read observation, inbox items and views (#923); device-limited grants (dropped); sync paging (waits for its trigger); history import (owner decision 10).
