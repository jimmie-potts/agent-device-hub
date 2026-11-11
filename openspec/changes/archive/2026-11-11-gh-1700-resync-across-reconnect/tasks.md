## 1. Behavior

- [x] 1.1 Write failing tests: `sync.test.ts` (a later sync answered `interrupted` waits for the next gap notice and applies no live message; a first sync answered `interrupted` is refused) and `remote.test.ts` (a reconnect that straddles a second restart, a refusal heard before the lost stream, a refusal while the stream stays open, which keeps the first refusal's detail, a first sync that cannot reach the edge, which is refused at once, and a `forbidden` refusal during a reconnect). Each fails without the change, except the first-sync and `forbidden` cases, which guard unchanged paths and fail if the wait reaches a first sync or another refusal is retried.
- [x] 1.2 Add `SyncInterrupted` to the `SyncTransport` seam and its handling in the copy; mark refusals in the remote client's sync request and wait for the stream's loss within the deadline. Verify with the tests above and the SDK suite.

## 2. Documentation and delivery

- [x] 2.1 Update `packages/sdk/README.md` where the copy's end and reconnects are described.
- [x] 2.2 Run build, typecheck, lint, workflow checks, the SDK suite and the runtime unit suite, and record the results in the PR.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent review, merge and installation follow outside this change.
