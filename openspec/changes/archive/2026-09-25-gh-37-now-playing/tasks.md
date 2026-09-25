## 1. Hub authorization and Sony controls

- [x] 1.1 Add failing hub tests: a launcher session reads the playback snapshot, sends a declared command and sees the source in its dashboard context, while a credential without the source sees none. Then add the source to launcher sessions and to the context. Evidence: the new tests fail before the change and pass after it. Verified red on base `15c9c2a` (context `playback` undefined) and green after.
- [x] 1.2 Add a failing Sony test for paused controls (next and previous only) and stopped/unknown (none), then change the Sony declaration. Evidence: `apps/hub/tests/playback.test.mjs` passes and the paused route test admits next. Verified red first: paused controls were `[]` and a paused next returned 422.

## 2. MCP playback tools

- [x] 2.1 Add failing MCP tests for discovery by scope and grant, status and command calls, duplicate request IDs, typed rejections, uncertain results, staged refusal and credential changes. Then register the source-bound tools and list the source in `hub_devices`. Evidence: `npm run test:hub:mcp` passes. Verified red first: no playback tools were listed and `hub_devices` had no `playback`.

## 3. Dashboard now-playing view

- [x] 3.1 Add failing unit tests for playback control availability and receipt mapping, then implement them in `apps/dashboard/src/client.ts`, including the fresh-read command builder. Evidence: `npm run test:dashboard` passes. Verified red first: the helpers did not exist.
- [x] 3.2 Add the now-playing view with the fresh-read command path and a separate API channel. Add a matrix scenario with a fake Sony receiver covering playing, paused, read-only, stale/unavailable, a refused action and an uncertain lock, plus an axe check. Evidence: `npm run test:dashboard:browser` passes. Verified red first: the scenario timed out waiting for the now-playing navigation entry.

## 4. Documentation and qualification

- [x] 4.1 Update the hub README (Playback, browser sessions, MCP), the dashboard README and `docs/development.md`, and bump the hub package version to 0.3.3. Evidence: the text matches the tested behavior.
- [x] 4.2 Run `npm run build`, `npm run typecheck`, `npm run test:hub`, `npm run test:hub:package`, `npm run test:hub:mcp`, `npm run test:dashboard`, `npm run test:dashboard:browser`, and the contract, agent-state, MCP and workflow checks on Node 24. All must exit zero; results go in the PR.
- [x] 4.3 Synchronize the four spec deltas and archive this change before final review. Independent reviews, UI approval, current-head CI, guarded merge and post-merge installed acceptance stay with the SDLC and the issue.
