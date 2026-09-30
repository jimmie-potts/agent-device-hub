## 1. Hub route

- [x] 1.1 Add hub route tests that fail first: `read` scope, another alias and a missing mutation header answer `forbidden`; an extra field, a palette, a bad mood ID and out-of-range durations answer 400 with no controller request; an undeclared mood answers `not-sent` with no command; a valid request sends exactly one moment with a fresh ID, `event` and no palette; a held POST answers `uncertain` within 3 s and the controller sees one request.
- [x] 1.2 Implement `apps/hub/src/moment-route.ts` and the route branch in `server.ts`; the focused tests and the existing hub suite pass.

## 2. Dashboard

- [x] 2.1 Add client and lifecycle unit tests that fail first: capability detection, mood labels and grouping, presets, the undeclared line with moments, result words for each outcome, the live line for scheduled, playing, each ending and the named or unnamed last moment, and `interpret`/`describe` in the lifecycle.
- [x] 2.2 Implement the helpers, the lifecycle extension points, the 1.1 device read, the Moments card with its faster refresh and the undeclared line; the unit tests and typecheck pass.
- [x] 2.3 Give the dashboard fixture a moment-capable 1.1 wall built on the contract's `admit` and `moment` reference, and add a browser suite covering AC1 to AC5 with the command spy, axe at 1280 and 390 px, keyboard focus and reduced motion; update existing browser expectations for the new undeclared line. `npm run test:dashboard:browser` passes.

## 3. Verification

- [x] 3.1 Add the `moments` scenario and the `moment-plays`, `moment-blocked-on-status` and `moment-uncertain-no-replay` steps to the Hub plug-in and serve process, with the fault variants that make each fail; extend `steps.test.mjs`. `npm run test:hub:verify` passes.
- [x] 3.2 Update the verification README feature map, the reference-step counts in `docs/development.md` and `docs/app-verification.md`, the Dashboard and Standalone hub sections, the app READMEs and the style guide's unavailable-control row.

## 4. Delivery

- [x] 4.1 Run the required checks from the worktree root with Node 24, synchronize both specs and archive this change on the delivery branch.
