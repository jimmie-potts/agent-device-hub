## 1. Contracts and edge

- [x] 1.1 Add the seven `coding-*` families with schemas, types, fixtures and contract tests; verify blank, oversized, mixed and extra-field payloads are refused and bounds are enforced.
- [x] 1.2 Add the `coding-worker` credential role, its endpoint-only edge grant, the gateway's lost-endpoint occurrence and its refusal of direct `coding-*` dispatch; verify with credential and access tests.

## 2. Core and module

- [x] 2.1 Forward `coding-dispatch` from companions through the tracked dispatcher as `coding-run`; verify with a core test that only companions may dispatch and the operation completes when the module settles it.
- [x] 2.2 Add the coding coordinator and store: one endpoint, one operation, start deadline, tracked outcome at start, delivery of results, cancel, lost and restart; verify with coordinator tests.
- [x] 2.3 Add `delegate_coding`, the delegation proposal bound to the coding revision, the `await` and `delivered` nodes, `deliver`, the owner-answer refusal and the cancel hook; verify end to end through the module with a fake worker on the bus.

## 3. Worker and page

- [x] 3.1 Add the host worker program and launcher: private configuration, endpoint declaration, worktree creation, headless harness invocation with bounds, git facts, progress reports and cancel; verify with a fake harness and a temporary repository.
- [x] 3.2 Show delegation proposals, the waiting state, the worker's availability and the result on the Conversation page; verify with the synthetic provider's delegation path in the browser journey.

## 4. Specifications and guides

- [x] 4.1 Write the worker guide, update the companions README and the architecture note; verify by instruction readback.
- [x] 4.2 Run root build, lint, typecheck, the companions suite, the runtime unit tests, contract tests and the browser journey on Linux, then synchronize the delta specs and archive this change before final review.
