## 1. Routes and widget catalog

- [x] 1.1 Add `apps/dashboard/src/routes.ts` with the discriminated route, `parseRoute` and `routeHash`; verify `apps/dashboard/tests/routes.test.mjs` covers the home aliases, the `activity`/`connections` alias collision, round-trips and missing addresses.
- [x] 1.2 Add `apps/dashboard/src/widgets.ts` with the catalog, `homeLayout` and `invalidPlacements`; verify `apps/dashboard/tests/widgets.test.mjs` checks every entry's fields and the placement validity.

## 2. Controls as cards and the views

- [x] 2.1 Move the form and action primitives and the device control cards into `apps/dashboard/src/controls.tsx` over one `deviceControls` read; verify `npm run typecheck:dashboard` passes and `main.tsx` keeps no second copy of a control.
- [x] 2.2 Rebuild `main.tsx`: hash routes with synchronous link navigation, the home widget grid, the dense component page with the status strip, Details and panels, compact session rows, the two-card Connections page and the one-line login; verify the browser suite's home, routing, alias and height checks pass.
- [x] 2.3 Add the spacing and type tokens to the skin and rewrite `style.css` on tokens; verify `npm run test:dashboard` (style checks) passes.

## 3. Evidence

- [x] 3.1 Extend `apps/dashboard/tests/browser.mjs` with the first-screen, width-reach, routing, alias-collision, unknown-address and 1,280 px height checks, and update the matrix, retirement and local-controllers suites for links and the Details disclosure; verify `npm run test:dashboard:browser` passes.
- [x] 3.2 Capture the design candidate (static HTML and screenshots at 1440 px and 390 px for login, home, wall, pixel and Connections) outside Git and list them on the PR for the owner's approval.
- [x] 3.3 Update the dashboard README, `docs/development.md` and style guide sections 4, 7 and 12 with the new structure and measurements; verify the relative links resolve.
- [x] 2.4 Owner decision on the design candidate (2026-09-25): remove the Apply buttons, send sliders once on release, make Power a button; port the form primitive, Power, Media and Scenes, share lifecycle state per control between the home widget and the page, and update the spec requirements; verify the four browser suites and `npm run test:dashboard` pass.
- [x] 3.4 Run `npm run build`, `npm run typecheck`, `npm run test:dashboard`, `npm run test:dashboard:browser`, `npm run test:hub:built`, the contract and workflow checks on Node 24; record the results on the PR. Synchronize the `unified-dashboard` delta and archive this change before final review. Independent reviews, current-head CI, the owner's approval of the UI candidate, guarded merge and merged-main readback remain SDLC gates.
