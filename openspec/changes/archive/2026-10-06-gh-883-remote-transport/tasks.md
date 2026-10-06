## 1. Tests first

- [x] 1.1 Write `tests/conformance.test.ts` (one suite, run against `inProcess` and `remote` from `tests/transports.ts`) and `tests/remote.test.ts`, against stubs of `RemoteEdge`, `connectRemote`, `publishMessage`, `requestMessage` and `syncMessage`. 18 tests fail and the rest pass: the 11 remote conformance cases, the six remote-only tests and the in-process prepared-message case.
- [x] 1.2 Write the fixture test for the sync subject rule. It fails while the #842 fixtures use `core`.

## 2. Implementation

- [x] 2.1 Add `Sdk.publishMessage` and the bus's `requestMessage` and `syncMessage`, which send prepared messages unchanged (`src/in-process.ts`, `src/in-process-sync.ts`).
- [x] 2.2 Add `RemoteEdge` (`src/remote-edge.ts`):
  - bearer tokens compared in constant time;
  - inbound validation with the 256 KiB cap and expiry;
  - one event stream per connection, written with socket backpressure;
  - forwarded commands and sync requests;
  - the `too-large` cap on sync answers;
  - a 1 s grace past each expiry.
- [x] 2.3 Add `connectRemote` (`src/remote-client.ts`):
  - every message built by the client;
  - subscribe resolved on the edge's registration;
  - client-side bounded queues;
  - reconnect with registration again and a gap notice with no count;
  - `uncertain-result` and `unavailable` deadlines.
- [x] 2.4 All 96 SDK tests pass across 15 consecutive runs of `npm run test:sdk:built`. A first version raced the requester's deadline: the edge's forwarded command refused at the expiry, and failed checks left gated handlers running at close. The edge now waits 1 s past each expiry, and the gated tests release their handlers before checking.
- [x] 2.5 Give the fixtures' sync messages and the mapping test's publisher the family-list subject; the fixture test passes.

## 3. Negative controls

- [x] 3.1 Run each control against the committed implementation, then restore it:
  - resolving `subscribe` before the edge registers it fails the remote subscribe-live, stalled-subscriber and malformed-call cases (decision 2);
  - reconnecting without the gap notice fails the reconnect and oversized-snapshot tests (decision 3);
  - dropping the sync answer cap fails the oversized-snapshot test (decision 4);
  - accepting any token fails the credentials test (decision 7);
  - logging the authorization header fails the same test (decision 7);
  - writing without waiting for drain fails the slow-consumer test (decision 8);
  - skipping inbound validation fails the refused-message and expired-sync tests (decision 9).

## 4. Docs and validation

- [x] 4.1 Document the remote transport, `publishMessage` and the optional `dropped` count in `packages/sdk/README.md`. Record the subject rule in `packages/event-contracts/README.md`, and update `docs/development.md` and `docs/architecture.md`.
- [x] 4.2 Validate this change with `--strict`, then sync and archive it. `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:sdk:built` three times, `npm run test:events:built`, `npm run test:workflow`, `npm run check:workflow` and `npm run openspec -- validate --specs --strict` all exit zero.

## 5. Rebase onto #880

- [x] 5.1 Move `publishMessage` into a self-contained first commit on main after #880 (`tests/prepared.test.ts`), for #882's outbox. Its two tests pass, and removing the source check fails one of them.
- [x] 5.2 Replay this change onto it. The bus's prepared entry points now sit on #880's dispatch, and the sync dispatch takes #880's abort signal.
- [x] 5.3 Write the alignment tests first:
  - the in-process queued-command expectation becomes `expired`;
  - a closed participant refuses every call, on both transports;
  - closing a participant cancels its first sync and withdraws its waiting request, on both transports;
  - a remote requester's deadlines run on its injected scheduler.

  The remote close case and the scheduler test fail.
- [x] 5.4 Make the remote participant a `Participant` whose close closes its copies. Honor `OutgoingSync.signal` by dropping the HTTP call, and withdraw it at the edge. Run the client's and the edge's waits on an injectable scheduler. All 120 SDK tests pass.
