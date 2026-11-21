## Why

Native B.U.N.N.Y. assistant tasks are visible only on the Conversation page. Status devices, Habitat and automations read the hub's shared session model, which knows only Codex and Claude. [#505](https://github.com/jimmie-potts/agent-device-hub/issues/505) reports each assistant task through that model, as accepted on [#1855](https://github.com/jimmie-potts/agent-device-hub/issues/1855). It builds on the flattened core and `session/3.0` contract of [#1865](https://github.com/jimmie-potts/agent-device-hub/issues/1865) and the task, run and question identities of [#499](https://github.com/jimmie-potts/agent-device-hub/issues/499).

## What Changes

- Add the native source `bunny`/`assistant` to the supported-source definition, with the companions module as its only producer.
- Add `session/3.1`, `lifecycle/2.2` and version 2.1 of `attention-raised`, `attention-cleared` and `turn-ended`. Each widens the identity to the native source. `lifecycle/2.2` adds the common inputs `turn-waiting` and `turn-uncertain` and an optional `result` on `turn-ended`. `session/3.1` keeps that result on the notice. The core publishes each record and occurrence in the lowest version that expresses it, so Codex and Claude output stays `session/3.0` and 2.0.
- Map each assistant task to one root session, each explicit activation (run) to a turn, and each saved owner question or approval to one attention item. The companions engine publishes the observations through its existing SDK outbox, in the transaction that commits the task change.
- Bind the native source to the companions module in the core, and refuse it from every other producer.
- Move the status function's `finished` detail to the notice's result, so a finished task never claims success unless it succeeded.
- Adopt the new versions in every current reader through the shared read function, and adjust the readers that name providers.
- Native worker reporting stays deferred.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: assistant tasks are reported as shared monitoring sessions.
- `bunny-message-profile`: native source entry, `session/3.1`, `lifecycle/2.2` and the 2.1 occurrence versions; the read function reads `session/3.0` and `3.1`.
- `bunny-runtime`: the core takes native observations under source binding, applies the new inputs, selects the published version per record and states native tasks under the session limit.

## Impact

Contracts (`packages/event-contracts`), the core's session logic and store (`apps/runtime/src/core`), the companions engine (`modules/companions`), and the readers that name providers (Nanoleaf source configuration, the Tronbyt tile fallback, the dashboard and Habitat names, the companion part). Hooks, producer files and read-receipt helpers are unchanged. Installed, client and physical acceptance stay with [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869).
