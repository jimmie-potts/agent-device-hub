## Why

[Hub #244](https://github.com/jimmie-potts/agent-device-hub/issues/244): each monitor read by a B.U.N.N.Y. browser session allocates a command-ticket ledger for that session's principal. Logout, expiry and oldest-session eviction remove the browser credential but never retire that ledger or its settled replay entries. The 16-session cap therefore does not bound ledger entries across repeated launches on the single-operator hub. This is a source finding; retained bytes and real memory growth have not been measured.

## What Changes

- Give browser-session resources one hub-local owner and one idempotent retirement path. Logout, the eight-hour expiry, eviction at the 16-session limit, credential replacement and shutdown all use it for the credential, its change streams, its ticket ledger and its replay accounting.
- A retired session admits no new work. That includes a command whose headers were authorized before logout but whose body arrived after it. A command the session had already admitted keeps running and is not cancelled or sent again. Its replay entry stays charged until the command settles and is then released once.
- Logging out of a dashboard opened with a configured credential ends no session. That credential keeps its streams, ticket sequence and retained results. Previously, such a logout closed every change stream of that configured principal, including other consumers' streams.
- Expired browser sessions are pruned on every authentication, not only on browser-token authentication.
- The host handle gains in-process resource counts for tests. There is no HTTP diagnostics route.
- Hub package version 0.3.2.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: browser session retirement releases that session's tickets, streams and replay accounting, refuses late work, keeps admitted work tracked until settlement, and leaves configured credentials unaffected by a dashboard logout.

## Impact

Code: `apps/hub/src/server.ts` and the new `apps/hub/src/replay.ts`, plus focused hub tests, the hub README, `docs/development.md` and the hub package version. Wire routes, scopes, alias limits, Host/Origin checks, request identities, restart epochs and the 256-entry/262144-byte replay limits are unchanged. Controller command routes keep their controller-owned replay. The dashboard is unchanged. Process-wide profiling stays with [Hub #123](https://github.com/jimmie-potts/agent-device-hub/issues/123). This is source-only: no installation, live state or device operation.
