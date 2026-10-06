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

## 6. Review of PR #909

- [x] 6.1 Write the review tests first. 13 fail, and the tests that pin existing checks pass:
  - a dropped stream and a held command;
  - a reply on the reconnected stream;
  - the edge's deadline answer and a silent edge;
  - the queued command `expired` on both transports;
  - close with a waiting request, on both transports;
  - rebuilt refusals;
  - `MAX_TIMEOUT_MS`;
  - a call on a lost stream;
  - sync clock skew;
  - the sync subject at the edge;
  - grant validation;
  - close cancelling the backoff.

  The pinning tests are: another source's connection, responders and owners after reconnects, a responder ignoring an expired command, the edge refusing an expired command, and the sync subject in the conformance suite.
- [x] 6.2 Implement the fixes in `src/remote-edge.ts`, `src/remote-client.ts`, `src/in-process.ts`, `src/in-process-sync.ts`, `src/sync.ts` and `src/sdk.ts`. All 136 SDK tests pass.
  - Items 1 to 4: an edge-level map for forwarded calls; the edge answering when its bus settles; the requester's 1 s grace; close settling requests; the dispatch signal; rebuilt refusals.
  - Items 6 to 12: the gap order; `unavailable` on a lost stream; the backoff cancel; `MAX_TIMEOUT_MS`; edge hygiene; the subject check; the sync clock-skew mapping.
- [x] 6.3 Run a negative control for each item, each restored afterwards; every one fails its tests:
  - answering written commands on a drop (2 tests);
  - restoring the edge grace (4);
  - dropping the requester grace (1);
  - close leaving requests (1, hangs);
  - close returning a new promise (1);
  - no rebuild (1);
  - no connection-owner check (1);
  - drop keeping what the connection opened (1);
  - the client handling expired commands (1);
  - the edge ignoring expiry (2);
  - keeping `not-found` (1);
  - keeping `expired` for a sync (1).
- [x] 6.4 Update the README, the `bunny-sdk` spec (now also modifying the request and sync requirements for `MAX_TIMEOUT_MS`), this delta and design.md. The synced spec and the delta stay identical.

## 7. Final review of PR #909

- [x] 7.1 Write the tests first. Four fail:
  - the edge's close while a remote handler holds a command;
  - the forward's wait running out on the edge's own scheduler;
  - an already-aborted prepared command;
  - a retry that reuses a held command's `requestId`.

  A deterministic gap-order test holds the second re-registration through a harness hook; it passes, and reverting the order fails it.
- [x] 7.2 Fix the remote handling of held and forwarded commands:
  - the bus reads the internal `unanswered` and `undelivered` markers from a forwarding responder;
  - the edge settles held commands through `unanswered` at close and at its own timeout;
  - an aborted signal settles `cancelled` before the command is queued;
  - forwards are keyed by message id and delete only their own entry, and the client sends that id with each reply and answer.

  All 141 SDK tests pass.
- [x] 7.3 Run the controls:
  - an error body at close fails the close test;
  - an error body from the late timer fails the scheduler test;
  - the old aborted-signal order fails its test;
  - keying by `requestId` fails the retry test;
  - the old gap order fails the gap test.

  Deleting any entry instead of only its own fails nothing: with message-id keys, two live entries cannot share a key, so that guard is defense in depth.
- [x] 7.4 Note in the README deadline table that a remote part's own expired sync gets `unavailable`. Narrow the conformance requirement's never-runs clause to a command still queued when the edge sees the dropped call. The synced spec and the delta stay identical.
