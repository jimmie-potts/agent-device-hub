## Why

[Hub #335](https://github.com/jimmie-potts/agent-device-hub/issues/335) gives the hub one shared sender for controller contract 1.1 moments ([ADR 0006](../../../docs/decisions/0006-hub-moments-and-interludes.md), [contract 1.1 Moments](../../../docs/controller-contract.md#moments-api-11)). Rules and routines (#358, #359), agent proposals (#295), choreography (#297) and the owner's "try a mood" control (#336) all need it. Today the controller client cannot send a moment: its command path validates only a 1.0 request, and it rejects a busy slot at once instead of waiting. [Hub #576](https://github.com/jimmie-potts/agent-device-hub/issues/576) added the negotiated 1.1 read and the shared fake controller this story builds on.

## What Changes

- The per-device controller client gains an opt-in wait of at most 2,500 ms for its one busy slot, used only by sends. Dashboard, MCP and route reads keep the immediate `capacity` rejection.
- The client gains a 1.1 moment command path: it validates `requestV1_1`, POSTs once, validates `receiptV1_1` and the echoed ticket, and reports `uncertain-result` on a mismatch or a lost response. The 1.0 command path is unchanged.
- A new internal module, `apps/hub/src/moment-sender.ts`, sends one moment to one device per call. It waits for the slot, reads a fresh 1.1 snapshot through the negotiated read, builds one request in the controller's clock from a hub-monotonic start instant, POSTs it once and returns one typed result: the controller's receipt, a not-sent reason or `uncertain`.
- The shared fake controller gains moment admission through the contract's reference `admit`, scripted answers, a holdable request and a moment spy.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `standalone-hub-host`: the bounded slot wait for sends, the 1.1 moment command path and the moment sender.

## Impact

`apps/hub/src/controllers.ts`, the new `apps/hub/src/moment-sender.ts`, hub tests and the shared fake in `apps/hub/tests/fake-controller.mjs`, `apps/hub/README.md` and the standalone hub section of `docs/development.md`. Nothing changes under `packages/contracts`. The story adds no route, MCP tool, page, durable state or policy; callers arbitrate. Installing the hub and any live moment are separately authorized steps and need a controller that serves 1.1 (codex-nanoleaf#158 or divoom-app-upgrade#92) and a caller (#336 or #358).
