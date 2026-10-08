## 1. Tests first

- [x] 1.1 Bundle `@jimmie-potts/sdk/remote` for a browser, and check a browser session's calls and a refused reconnect, in `packages/sdk/tests/browser.test.ts`. Evidence: the negative controls in 4.2 fail it.
- [x] 1.2 Check the gateway's page, its contexts, methods, queries and an unbuilt dashboard in `apps/runtime/tests/dashboard-page.test.ts`, and move the route-map test off `/`.
- [x] 1.3 Convert the copied route, widget and style tests, and add `tests/sessions.test.ts` for the session rows.
- [x] 1.4 Write the smoke check and the full browser suites against the built runtime with the core and a synthetic hook.
- [x] 1.5 Add the `dashboard-sessions` and `dashboard-finished-turn` catalog scenarios.

## 2. SDK and gateway

- [x] 2.1 Move the error body to the contracts' `v2/errors`; give the SDK's remote graph Web Crypto and a run-time async context; add `@jimmie-potts/sdk/remote`, `{browser: true}` and `remote.refused`. Evidence: `test:sdk:built` and `test:events:built` pass.
- [x] 2.2 Serve `/`, `/dashboard.js` and `/dashboard.css` from `dist/dashboard/` with the page checks. Evidence: `dashboard-page.test.ts` and the gateway tests pass.

## 3. The dashboard

- [x] 3.1 Copy the files this slice converts, in a commit of their own, with PROVENANCE.md.
- [x] 3.2 Convert the shell, routes, widgets, skin and Places; add sign-in, the sessions copy, the session rows and the panel slots. Evidence: the unit tests, the smoke check and both browser suites pass.
- [x] 3.3 Build the page in `npm run build`, type-check it in `npm run typecheck`, lint it, and run its unit tests in the core job and its smoke check in App verification.

## 4. Docs and checks

- [x] 4.1 Document the dashboard (its README and provenance), the gateway's page, the SDK's browser parts, the contracts' `v2/errors`, the catalog, a run's dashboard steps and the checks.
- [x] 4.2 Run the gate and the negative controls; sync and archive this change.

## 5. Fix round 1

- [x] 5.1 Prove the two-tab Disconnect regression fails at the original PR head and passes with shared sign-in and session replacement.
- [x] 5.2 Verify positive read evidence and any consumer acknowledgment clear unread without a page command; update catalog, provenance and acceptance steps.
- [x] 5.3 Gate the candidate, synchronize all three affected specs and rearchive. Evidence: runtime verification passes 67/67 with zero skips; both browser drivers and both dashboard smoke checks pass; every delta requirement matches its main spec.

## 6. Standards correction

- [x] 6.1 Carry W3C context on all five sign-in/read calls and through their authenticated gateway handoffs; retain pure red/green and invalid-parent/ownership checks.
- [x] 6.2 Map approval/input chips and dots to the blocked token, keeping continuing questions separate; retain the mapping regression's red/green results.
- [ ] 6.3 Rebase on the coordinator's final base, run the remaining runtime/browser gates, then synchronize and rearchive before final review.
