## Why

[Hub #881](https://github.com/jimmie-potts/agent-device-hub/issues/881) is story C of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). In the amended ADR 0012, sync replaces latest-value retention: a consumer syncs from the owner when it connects or restarts, then follows live messages. Every consumer relies on it. The #879 bus also left one gap for this story: a subscriber whose bounded queue dropped a message is not told, so it can keep a silent gap in its copy.

## What Changes

- **`sync` for consumers.** `sync(families, handler, {timeoutMs, maxBuffered?, parent?})` keeps a copy of one owner's families. It subscribes to their state keys and sends a sync request. Live messages wait in a bounded buffer until the owner answers with its current state at a revision and `sync.completed`. The copy then takes the states and replaces its membership. Buffered messages above the revision apply afterwards, in order. The handler hears of each change: `updated`, `removed`, `synced` and, for a later sync that cannot be served, `failed`. `get` and `states` read the copy.
- **Restart on overflow.** A buffer overflow, or a message dropped on one of the copy's subscriptions, sends a new sync request. The answer to the old request is ignored, so partial state is never combined.
- **`serveSync` for owners.** `serveSync(families, provider)` serves sync requests from the owner's current state. One owner serves each family. The provider returns `{revision, states}` or an error body, and the SDK sends each state and then `sync.completed` straight back to the requester. A refusal comes back in the shared error body from the `sync` call, and no `sync.completed` follows.
- **Protections.** There is no replay: a snapshot holds current state messages only. Duplicates, stale revisions and anything at or below the sync revision are dropped, and removal tombstones keep a late state from bringing an entity back. These rules agree with Hub #842's reference consumer (`packages/event-contracts/tests/consumer.mjs`).
- **Overflow signal.** `subscribe` takes `onOverflow`. After a full queue drops messages, it runs in the subscription's order, before the next message, with the number dropped. `onError` still receives each `capacity` report.
- **Docs.** The SDK README documents sync and the overflow signal. `docs/development.md` and `docs/architecture.md` note that the source now includes sync.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-sdk`: per-subscriber delivery gains the overflow signal, and the SDK gains sync for consumers and owners.

## Impact

- **Source:** `packages/sdk/`, under the strict profile. New files hold the transport-neutral consumer (`src/sync.ts`) and the in-process owner side (`src/in-process-sync.ts`). The shared files change only where sync and the overflow signal need it: `src/sdk.ts`, `src/in-process.ts`, `src/index.ts` and `tests/support.ts`. Tests are in `tests/sync.test.ts` and `tests/overflow.test.ts`.
- **Docs:** `packages/sdk/README.md`, plus one line each in `docs/development.md` and `docs/architecture.md`.
- **No CI change:** the core CI job already runs `npm run test:sdk:built`, which runs every compiled SDK test.
- **Nothing else:** nothing runs the bus yet. There is no runtime, Hub, controller, contract or device change. Sync over the remote transport is #883. Delivery target: source-only.
