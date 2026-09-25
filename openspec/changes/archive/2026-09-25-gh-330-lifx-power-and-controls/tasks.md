## 1. Host on-demand reads

- [x] 1.1 Write failing host tests: a snapshot read of a never-read qualified bulb queues exactly one LightGet, repeated reads within 30 s send nothing, the clock passing 30 s allows one more, an unqualified bulb is never read, no reads means no traffic, a failed read keeps the previous observation, and request IDs are unchanged. Then implement the bounded read in `host.ts`; verify with `npm run test:local-controllers`.
- [x] 1.2 Update existing host and dashboard expectations that assumed zero traffic after a qualified bulb's snapshot read, and list each in the PR.

## 2. Dashboard

- [x] 2.1 Write failing browser checks: unknown power starts empty and both choices send one command; observed off starts at Off with the reading's age; the Tidbyt and `beam` views show one line and no forms; disabled buttons have distinct computed colors. Then implement the Power rule, the no-controls lines and the disabled tokens; verify with `npm run test:dashboard` and `npm run test:dashboard:browser`.
- [x] 2.2 Capture screenshots for the owner's UI approval, kept outside Git.

## 3. Delivery

- [x] 3.1 Bump the hub to 0.3.7 and update the host and dashboard READMEs and `docs/development.md`. Verify by inspection.
- [x] 3.2 Run build, typecheck, the local host, hub, hub package, MCP, dashboard and workflow checks. Then synchronize the spec deltas and archive this change.
