## Why

[Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922), part of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): the B.U.N.N.Y. dashboard reads the old Hub's 1.x snapshots, polls them and holds a bearer token in the page. The runtime ([ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)) has no page yet: its gateway (#835) signs a browser in with a cookie session acting as `bunny/parts/dashboard`, and the core (#831) publishes each session's record, with its unread finished turn, through sync. This change is the story's first slice: the shell, sign-in and the agent sessions on the runtime. Device cards and music (the second slice) and module pages and the run preview (the third) follow as their own changes.

## What Changes

- **A copy of the dashboard in the runtime.** `apps/runtime/dashboard` copies the shell, routes, widget catalog, Neon skin and their tests from `apps/dashboard` at main 5abbae9, with provenance notes, and converts them to the strict profile. The old dashboard is untouched.
- **The gateway serves it.** `GET /`, `/dashboard.js` and `/dashboard.css` come back on the old Hub's paths, without a session, with the old Hub's page checks (Hub #561).
- **Sign-in.** The page uses the browser's live session, else a trusted loopback session or the launcher's code, marks every change with `bunny-request: 1`, and offers one Sign in again when its session ends.
- **HTTP context and attention colors.** The five sign-in/read calls carry W3C context through their authenticated gateway handoffs. Approval/input use the blocked chip token, distinct from continuing questions.
- **Sessions through SDK sync.** One remote participant syncs the core's `session` family and follows it; a lost stream resyncs with nothing replayed. Each row comes from its record alone, and a finished turn stays unread until the record clears it.
- **The SDK in a browser.** `@jimmie-potts/sdk/remote` is the client alone, with no Node built-in in its graph; `connectRemote({browser: true})` sends no token and marks every call; `remote.refused` says once that the edge refuses a reconnect. The contracts' error body moves to a `v2/errors` module that reads no file.
- **The approved home**, with slots for the Hub mode (#924) and the inbox (#923).
- **Checks.** Unit tests in the core job, a browser smoke check in App verification and the full browser suite locally, as PR #986 did for the old dashboard; two catalog scenarios for tier 1 and a run's tier 2 steps.

## Capabilities

### New Capabilities

- `runtime-dashboard`: the dashboard on the runtime: its shell and routes, sign-in on the gateway, the sessions it syncs from the core, the finished turn from the record, the approved home and Places on a run.

### Modified Capabilities

- `bunny-runtime`: the gateway serves the dashboard's page; the route map serves `/` again; the catalog covers the dashboard.
- `bunny-sdk`: a browser page as a remote part.

## Impact

- **Code:** `apps/runtime/dashboard/` (new); `apps/runtime/src/gateway/dashboard.ts` (new), `gateway.ts`, `runtime.ts` and `diagnostics.ts`; `packages/sdk/src/` (`remote.ts` new, `remote-client.ts`, `remote-protocol.ts`, `diagnostics.ts`, `envelope.ts`, `trace.ts`, `sync.ts`, `queue.ts`, `refusal.ts`, `index.ts`) and its `package.json` exports; `packages/event-contracts/src/v2/errors.ts`, `index.ts` and its `package.json` exports; `apps/runtime/verify/plugin.ts` (build sources and the candidate); `eslint.config.mjs` (the copy's browser globals, page drivers and hook rules).
- **Tests:** the dashboard's unit, smoke and browser suites, including `signin.test.ts` and the fixed-color assertion; `packages/sdk/tests/browser.test.ts`; `apps/runtime/tests/dashboard-page.test.ts`, `dashboard-trace.test.ts` and the recorded HTTP handoffs in `tracing.test.ts`; the route-map test in `gateway.test.ts`; two catalog scenarios.
- **Coordinator-owned files:** root `package.json` (the build and type-check steps and four `test:runtime-dashboard` scripts), `.github/workflows/checks.yml` (two steps), `tests/workflow_checks.cjs` and `docs/development.md`.
- **Unchanged:** `apps/dashboard` and its tests, the old Hub, the core's records and commands, the released 1.x contracts.
- **Delivery:** source-only, verified in disposable runs; installation is at the cutover (#840).
