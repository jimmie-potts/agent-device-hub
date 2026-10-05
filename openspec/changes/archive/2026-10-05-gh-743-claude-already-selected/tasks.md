## 1. Router (red, then green)

- [x] 1.1 Make the fake adapter model Claude's link behavior: no `lastFocusedAt` stamp for the session already shown in front (evidence: `routing-helpers.mjs`).
- [x] 1.2 Failing router tests for an already-selected target, a tie, a newer other session, an incomplete read before the link, Claude not in front before the link, another session moving after the press, a newer session learned after the link, and the unchanged changed-selection path; implement the already-newest evidence in `src/routing/router.ts` (evidence: `routing-router.test.mjs`).

## 2. Documentation and validation

- [x] 2.1 Update the Claude selection description in the bridge README and `docs/chompi-controller-qualification.md`.
- [x] 2.2 Run build, typecheck, the bridge suite and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the spec and archive this change before final review.
