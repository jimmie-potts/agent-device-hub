## Why

[Hub #883](https://github.com/jimmie-potts/agent-device-hub/issues/883) is story E of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 has remote parts make the same SDK calls as modules over SSE down and HTTP up, with the edge validating every message: the CHOMPI bridge, the Wispr collector, agent hooks, the dashboard and MCP clients. The 2.0 edge (#835), the CHOMPI bridge connection (#837) and #846's scenario over both transports need it.

## What Changes

- **Remote transport.** `RemoteEdge` mounts on a runtime's in-process bus with one bearer token per remote source. `connectRemote` gives a remote part the full `Sdk`: `publish`, `publishMessage`, `subscribe`, `request`, `respond`, `sync` and `serveSync`. One event stream per connection carries messages, commands and sync requests down. One POST per call carries calls up.
- **Prepared messages.** `Sdk.publishMessage` publishes a message built earlier, unchanged, for the edge and for #882's outbox. The bus's `requestMessage` and `syncMessage` send a prepared command or sync request unchanged. A remote part's messages keep their own `id` and `time`.
- **Edge protections.** The edge:
  - compares tokens in constant time;
  - refuses with `unauthenticated` or `forbidden`;
  - never puts a token in a message, log or error;
  - validates every inbound message against profile 2.0, the registered schemas and the 256 KiB cap;
  - refuses a sync answer over the cap with `too-large`, and logs it.
- **Slow consumers and reconnects.** The edge writes with socket backpressure, so a slow remote consumer fills only its own bounded queues. It is told of the loss through `onOverflow`. A reconnect registers everything again and tells every subscription of the gap. `onOverflow`'s `dropped` count is now optional, absent when unknown, so a sync copy resyncs. Nothing is replayed.
- **Conformance.** One suite runs against both transports, with per-transport deadline expectations.
- **Sync subject rule.** A sync request's subject names its families joined by commas, and its `sync.completed` carries the same subject. The profile docs and spec record the rule; the #842 fixtures follow it, and a fixture test checks it.
- **Docs.** The SDK README documents the remote transport, and `docs/development.md` and `docs/architecture.md` are updated.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-sdk`: prepared messages, the remote transport, the conformance suite, and an overflow notice with no count.
- `bunny-message-profile`: the sync subject rule.

## Impact

- **Source:**
  - `packages/sdk/`: new `src/remote-edge.ts`, `src/remote-client.ts`, `src/remote-protocol.ts` and `src/envelope.ts`, and small changes in `src/sdk.ts`, `src/in-process.ts`, `src/in-process-sync.ts` and `src/index.ts`;
  - new tests `tests/conformance.test.ts`, `tests/remote.test.ts` and `tests/transports.ts`, and an extended `tests/support.ts`.
- **Contracts:** `packages/event-contracts`. Only the fixtures' sync subjects, the mapping test's publisher, one fixture test and the README change. The validator and schemas are unchanged.
- **Docs:** the SDK README, `docs/development.md` and `docs/architecture.md`.
- **No CI change:** `npm run test:sdk:built` already runs every compiled SDK test, the new ones included.
- **Nothing installed:** no runtime, Hub, controller or device change. Tests bind 127.0.0.1 on a free port. Delivery target: source-only.
