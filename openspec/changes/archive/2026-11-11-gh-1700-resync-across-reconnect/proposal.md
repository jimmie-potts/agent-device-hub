## Why

[#1700](https://github.com/jimmie-potts/agent-device-hub/issues/1700): when a remote SDK client reconnects, each state copy asks for a resync. If the runtime restarts again while that reconnect reaches it, the resync is refused `unavailable` at the connection and the copy ends for good. Found in #1697, whose test now waits for the reader's resync before the next restart (#1702); the product behavior stayed open. The owner chose on 2026-11-11 to retry such a resync inside the SDK while the stream is reconnecting, unless every holder of a copy already recovers by itself. Several do not: the dashboard's music lighting feed stays stale until an explicit refresh, and the ONN widget, ONN history and Reachy Mini frontends mark the copy not live and read nothing again.

## What Changes

- The remote client answers a copy's sync request as `interrupted` when it was refused `unavailable` while the stream it went out under was lost. A resync that could not reach the edge while its stream still looks open waits, within its own deadline, to hear whether the stream was lost, and passes on its own refusal if the stream stays open. A first sync does not wait.
- A copy whose later sync is `interrupted` stays syncing with its last records and asks again on the next reconnect's gap notice. A first sync answered `interrupted` is refused as before.
- Unchanged: any other refusal, and one while the stream stays open, ends the copy with `failed`. No new timer, retry loop, message format or error shape. Reconnect pacing is unchanged and is the only pace of the repeat.

## Capabilities

### Modified Capabilities
- `bunny-sdk`: a later sync refused during a reconnect, and the remote client's `interrupted` answer.

## Impact

- `packages/sdk/src/sync.ts`, `packages/sdk/src/remote-client.ts`, the SDK tests and README.
- The in-process transport never answers `interrupted`. No contract, schema, storage or edge change. Installation follows a routine runtime upgrade separately.
