## 1. Hub

- [x] 1.1 Write failing hub tests in `apps/hub/tests/linked-navigation.test.mjs`. A same-site top-level document navigation to `/` loads the page on `127.0.0.1` and `localhost`, with or without trusted-loopback, and issues no session. The page carries `X-Frame-Options: DENY` and `frame-ancestors 'none'`. A cross-site, framed, fetched, Origin-carrying or foreign-Host request is refused. The assets, the API routes, the session route and the launch exchange refuse same-site requests, and a refused exchange leaves its code valid. Then admit the linked navigation and add the header in `apps/hub/src/server.ts`. Verify with `npm run test:hub`, and by mutating each condition of the admission in the built server.

## 2. Browser

- [x] 2.1 Write a failing Chromium check in `apps/dashboard/tests/trusted.mjs`. A link on another `127.0.0.1` port, and one between two `localhost` ports, opens the dashboard signed in in a new tab, and closing the tab logs its session out. A `localhost` page linking to `127.0.0.1` is refused as cross-site, and an iframe on the other app is refused and signs nothing in. Verify with `npm run test:dashboard:browser`.

## 3. Verification

- [x] 3.1 Make `integrated-lifecycle` click the Hub's Places Wall link and the wall's B.U.N.N.Y. link, and assert that each opens its page in a new tab: the wall with the step's session, and the dashboard signed in with it. Show the step failing at the B.U.N.N.Y. assertion on a pinned composition of the pre-fix Hub, and passing on a composition with the fix. Update the feature map in `apps/hub/verify/README.md` and `docs/app-verification.md`. The passing run from the delivery composition is recorded in the PR.

## 4. Delivery

- [x] 4.1 Document the linked page navigation, its threat model and its diagnosis in the hub README, the dashboard README and `docs/development.md`. Verify by inspection.
- [x] 4.2 Run the build, type, contract, package, hub, dashboard, app verification, preflight and workflow checks. Then synchronize the spec deltas and archive this change.
