## 1. Hub

- [x] 1.1 Write failing hub tests: the session route answers 404 without the option and issues nothing; an invalid `browserAccess` value refuses startup; with the option a same-origin request gets a read/control session that cannot ingest, quiesce or use MCP; a foreign Host, missing, foreign or mismatched Origin, cross-site `Sec-Fetch-Site`, missing header or non-empty body is refused with no session; `localhost` serves the page and API and refuses a mixed Origin; trusted sessions share the cap and retirement with launcher sessions. Then implement `browserAccess`, the shared session issuer, the route and the Host alias in `server.ts` and `cli.ts`. Verify with `npm run test:hub`.

## 2. Dashboard

- [x] 2.1 Write a failing browser check with the option on: a fresh context opens signed in on `127.0.0.1` and `localhost`, reload and a second tab stay signed in, the hub holds one session per open page after a reload, a failed route shows the alert and fallbacks, eviction offers "Sign in again", and Disconnect offers "Sign in". Then implement the sign-in on load, `pagehide` logout, back-forward restore and the sign-in actions. Verify with `npm run test:dashboard:browser`; the existing launcher and token scenarios cover the option-off path.
- [x] 2.2 Capture screenshots for the owner's UI approval, kept outside Git.

## 3. Delivery

- [x] 3.1 Bump the hub to 0.3.10 (0.3.9 was released for #412 while this change was in review) and document the field, the bookmark URL, `localhost` and the reduced assurance in the hub README, `apps/hub/SETUP.md`, the dashboard README and `docs/development.md`. Verify by inspection.
- [x] 3.2 Run build, typecheck, contract, hub, hub package, setup, MCP, dashboard and workflow checks. Then synchronize the spec deltas and archive this change.
