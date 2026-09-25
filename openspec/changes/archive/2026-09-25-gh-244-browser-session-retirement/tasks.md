## 1. Regression evidence

- [x] 1.1 Add `apps/hub/tests/browser-sessions.test.mjs` covering repeated launch, monitor read, command and logout, then expiry and oldest-session eviction, with resource counts returning to the configured-credential bound. Cover configured-credential logout keeping its tickets, retained result and stream while another browser session and MCP stay usable, and a command body delivered after logout. Verified red at `d85b8b3`: all three failed (ledger count 3 instead of 2, configured stream closed, late body executed with 200).

## 2. Single lifecycle owner

- [x] 2.1 Move tickets and replay accounting into `apps/hub/src/replay.ts` with idempotent retirement and settle-time release. Add `apps/hub/tests/replay.test.mjs`, where deferred fake operations resolve, reject or outlive their caller after retirement. Verify one run, no eviction of pending work, release once and no double release.
- [x] 2.2 Route expiry, eviction, logout, credential replacement and shutdown through one `retireBrowser` path. Re-check liveness before ticket use, and prune on every authentication. Verify the three HTTP tests pass.

## 3. Documentation and qualification

- [x] 3.1 Update the hub README's session and HTTP boundary text and `docs/development.md`, and bump the hub package to 0.3.1. Verify the text matches the tested behavior.
- [x] 3.2 Run `npm run build`, `npm run typecheck`, `npm run test:hub`, `npm run test:hub:package`, `npm run test:hub:mcp`, `npm run test:dashboard:browser`, the contract, agent-state, MCP and workflow checks. All must exit zero on Node 24. Record the results in the PR.
- [x] 3.3 Synchronize the `standalone-hub-host` delta and archive this change before final review. Independent reviews, current-head CI, guarded merge and merged-main readback remain SDLC gates.
