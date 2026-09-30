## 1. Shared fake controller and negotiation

- [x] 1.1 Add `apps/hub/tests/fake-controller.mjs` and client tests that fail first: a 1.1 read, the 1.0-only fallback with one extra read, no repeat probe in an epoch, a restart that now serves 1.1, timeout and 5xx leaving the verdict, a 1.0 answer to a versioned read, and zero command POSTs. Focused tests pass.
- [x] 1.2 Implement the verdict and the negotiated read in `ControllerClient` inside one slot. Existing controller tests pass unchanged.

## 2. Route and MCP

- [x] 2.1 Add route tests for the default 1.0 shape, `apiVersion=1.1`, and 400 for another value, a repeat or an extra parameter with no controller request, then implement the route.
- [x] 2.2 Add the MCP `status` test for `moments` and `moment` on the 1.1 fake and the 1.0 shape on the 1.0-only fake, then bind `status` to the negotiated read.

## 3. Delivery

- [x] 3.1 Update the standalone hub and hub MCP sections of `docs/development.md`, run the hub, hub MCP, MCP, contract, package and workflow checks from the worktree root, and synchronize and archive the specification.
