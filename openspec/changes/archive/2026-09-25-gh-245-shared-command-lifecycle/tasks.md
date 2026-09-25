## 1. Shared lifecycle

- [x] 1.1 Add `apps/dashboard/src/lifecycle.ts` with the transition function, the driver and the consumer wordings. Move `observedResult`, `Prepared` and the tone type there. Verify `npm run typecheck:dashboard` passes.
- [x] 1.2 Make `useCommand` and `EditForm` delegate to one `useCommandLifecycle` hook and remove their duplicated state, effects and submit sequences. Forms keep drafts and the revision conflict; callers keep request construction and availability. Verify with `git diff`: no second submit, watch or lock implementation remains in `main.tsx`.

## 2. Evidence

- [x] 2.1 Add `apps/dashboard/tests/lifecycle.test.mjs` covering, for both the form and action wordings:
  - blocked and failed preparation;
  - accepted and queued results with terminal receipts;
  - definite rejection without adopting another client's receipt;
  - uncertain and partial locks with explicit reload;
  - a later uncertain receipt;
  - a failed refresh;
  - a stale read.

  Verify that the tests fail when a rejected ticket is watched, when a refresh failure escapes, or when start keeps an old ticket, and pass on the implementation.
- [x] 2.2 Add a matrix scenario: a failed fresh read and a failed refresh on the Pixoo brightness form and the Pause action, plus a double activation that sends one command. Keep all existing matrix scenarios passing.

## 3. Qualification and delivery

- [x] 3.1 Update the dashboard README and `docs/development.md`.
- [x] 3.2 Run `npm run build`, `npm run typecheck`, `npm run build:dashboard`, `npm run typecheck:dashboard`, `npm run test:dashboard`, `npm run test:dashboard:browser`, and the shared hub, contract, state, MCP and workflow checks on Node 24. Record the results and the unchanged-UI comparison in the PR, and show the owner the candidate screenshots for approval.
- [x] 3.3 Synchronize the `unified-dashboard` delta and archive this change before final review. Independent reviews, current-head CI, human approval of the UI candidate, guarded merge and merged-main readback remain SDLC gates.
