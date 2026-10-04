## 1. Admission (red, then green)

- [x] 1.1 Failing tests for root-over-child displacement, subtree evidence ranking, running/unknown/attended protection, child rejection, non-creating, guarded, old and archived events and a failed displacement commit; implement `displaceableChild()` and the admission branch in `packages/agent-state/src/index.ts`, reusing `subtree()` in `retire()` (evidence: `packages/agent-state/tests/capacity.test.mjs`, full agent-state suite).

## 2. Versions, documentation and validation

- [x] 2.1 Bump `@jimmie-potts/agent-state` to 3.6.0 with every exact pin, the lockfile, `VERSION`, the Python artifact version and the packaging scripts; bump the Hub to 0.6.1 (evidence: `npm ci`, package suites).
- [x] 2.2 Update the agent-state README capacity rule and version notes, the Hub README, `docs/architecture.md`, `docs/event-contract.md` and `docs/development.md`, and modify "Runtime-end retirement" so displacement is its named exception.
- [x] 2.3 Run the agent-state, controller, lifecycle, MCP, Hub and workflow checks; record results in the PR.
- [x] 2.4 Synchronize the spec and archive this change before final review.
