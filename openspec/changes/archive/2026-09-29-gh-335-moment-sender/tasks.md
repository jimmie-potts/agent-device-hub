## 1. Bounded slot wait

- [x] 1.1 Add client tests that fail first against 1.0 loopback fakes: a held send waits for a read and then runs, a send still waiting after the bound fails with `capacity` and no controller request, reads keep the immediate `capacity` rejection while a send waits, and `close()` fails a waiting send. Implement the FIFO wait in `exclusive` and `ControllerClient.hold`. Existing controller tests pass unchanged.

## 2. Fake controller extensions

- [x] 2.1 Extend `apps/hub/tests/fake-controller.mjs` with reference-`admit` command admission, `answerNext`, `hold` and `moments()`, keeping the existing negotiation cases. The controller-version tests pass unchanged. The fake now admits 1.0 commands instead of refusing every POST, so the MCP status case expects a queued 1.0 receipt and checks a scripted typed refusal separately.

## 3. 1.1 command path

- [x] 3.1 Add tests that fail first for `momentCommand`: a receipt for the ticket after one POST, `uncertain-result` for a timeout, a dropped connection and a receipt for another ticket, a typed non-2xx receipt, and local rejection of a 1.0 envelope or another device. Implement it; the 1.0 `command()` tests pass unchanged.

## 4. Moment sender

- [x] 4.1 Add `apps/hub/tests/moment-sender.test.mjs` covering AC1-AC6 over loopback against the shared fake with an injected monotonic clock, failing first. Implement `apps/hub/src/moment-sender.ts` with exported input and result types.

## 5. Delivery

- [x] 5.1 Update `apps/hub/README.md` and the standalone hub section of `docs/development.md`, run the hub, setup, hub MCP, MCP, contract, package and workflow checks from the worktree root, and synchronize and archive the specification.
