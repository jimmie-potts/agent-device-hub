## 1. SDK: module API 1.2 and the edge's grants

- [x] 1.1 Assert that `checkContributions`, within `checkManifest`, accepts a `1.2` module's pages, content, tools and settings, refuses them in `1.0` and `1.1` modules, and refuses each malformed one (`packages/sdk/tests/contributions.test.ts`); move the manifest tests to `1.2`.
- [x] 1.2 Add `pages`, `content`, `tools` and `settings` to the manifest, `checkContributions`, and `MODULE_API_VERSION` `1.2`.
- [x] 1.3 Assert per-grant calls and key patterns, a grant the edge cannot read, a token used under another declared source, a command sent again after its first forward settled and while it waits, a refused command not remembered, heartbeats, a stalled reader's stream ended at the stall limit and a silent stream reconnected by the client (`grants.test.ts`, `remote.test.ts`).
- [x] 1.4 Add `calls` and `keys` to grants, the host's `authenticate` and `disconnectPrincipal`, the `bunny-source` header, the command memory, heartbeats, the stall limit and the client's idle limit on a separate liveness scheduler.

## 2. Contracts

- [x] 2.1 Add the `approval-recover` core command family with its schema, subject check and fixtures, and widen `duplicate-conflict`'s registry meaning to a command sent again.
- [x] 2.2 Add profile 1.4 to the diagnostic contract (artifact 1.4.0): `http.route`, `http.request.method` and `runtime.edge.reloaded`, closed to earlier profiles, with fixtures, TypeScript and Python tests, and the dependents' pins.

## 3. Runtime: the core and the configuration

- [x] 3.1 Assert the core's approval recovery and its refusals, and its `core_sessions` tool (`core.test.ts`).
- [x] 3.2 Answer `approval-recover` in the core through agent-state's `recoverApproval`, and contribute `core_sessions` (module API 1.2).
- [x] 3.3 Read the configuration file's `edge` section and the credentials file it names, refuse what they should not hold, and retire `edge-grants.json` (`edge.test.ts`, `process.test.ts`, `gateway.test.ts`).
- [x] 3.4 Check tool schemas and reserved argument names at admission, and give the gateway the hosted modules and contribution calls in each module's flow.

## 4. Runtime: the gateway

- [x] 4.1 Assert registry codes for every refusal, Origin and fetch-metadata checks for credentials and browser sessions, the launcher, credential reloads, MCP by scope, module pages, content and settings and their failures, the route map against the old Hub's sources, the conversion and a stalled reader at the runtime (`gateway.test.ts`).
- [x] 4.2 Serve the gateway: callers and browser sessions (`access.ts`), the launcher's socket (`launcher.ts`), `/api/v2` reads through SDK sync and the snapshot read API, the approval recovery route, module pages and content, MCP through `packages/mcp` unchanged (`mcp.ts`), the route map (`retired.ts`), refusals at their levels with the repetition rule, and SIGHUP reload.
- [x] 4.3 Add `convertHubEdge` for the cutover's installer, and `grantCredential` and `revokeCredential`.
- [x] 4.4 Measure the edge's memory under a stalled reader for #123 (`scripts/measure-edge-memory.mjs`).

## 5. Fixtures and tiers

- [x] 5.1 Give the fixture sign a page with its preview by reference, that content, a read tool and settings.
- [x] 5.2 Add `gateway-reads`, `grants-and-duplicates`, `approval-recovery` and `module-contributions` to the catalog, with the harness contract's `gateway` call and the parts' grants; mount the gateway in the in-memory harness on both transports.
- [x] 5.3 Seed disposable runs with the run's configuration file, the credentials and part token files and the launcher off; implement the adapter's `gateway` call; watch the MCP and device-contracts sources in `build-current`; scan every step's proof and records for the parts' token prefix.

## 6. Documentation and qualification

- [x] 6.1 Document the gateway, configuration and credentials in the runtime README, runs in the verify README, module API 1.2 and the edge's grants in the SDK README, the family in the contracts README and mapping, profile 1.4 in the contract and the observability README, and the runtime checks in `docs/development.md`.
- [x] 6.2 Show negative controls fail named tests: the edge's key and call checks, the declared source, the command memory, the stall and idle limits, a credential from a page, a browser change without the header, a reload that changes nothing, settings or a tool answer with a secret, an ingest scope that may request, contributions without 1.2, a route left out of the map, a recovery without its revision guard, a token in a refusal, and a throwing contribution that does not fail its module.
- [x] 6.3 Run build, typecheck, lint, the SDK, runtime, scenario, verify, event, observability, MCP and workflow checks, and OpenSpec validation.
- [x] 6.4 Synchronize the affected specifications and archive the change.

## 7. Review fix round

- [x] 7.1 Enforce the routing-ID rule for commands in the bus and for remote publishes at the edge; give grants `publishes` families and `excluded` keys, narrow subscriptions (`accept`, handlers told the key) and sync answers.
- [x] 7.2 Bound the command memory per source, by `REMEMBER_MS`, and forget commands the bus refused before a responder had them.
- [x] 7.3 Narrow `/api/v2` reads, module contributions and MCP tools by device grant; serve MCP only with the edge section's `mcp`; accept the request's own loopback origin; end evicted and expired sessions' streams; check the credential route first on `/mcp`.
- [x] 7.4 Check refusal and content text for secrets, serve owners' refusals without detail, match snapshot records by family, quote nothing a caller sent, and add `nosniff`.
- [x] 7.5 Lock credential writes, refuse changed files and other owners' grants, refuse duplicate and dashboard sources, queue SIGHUP during start, carry `mcp` and check links at conversion, and name #922 for the label command.
- [x] 7.6 Show negative controls fail named tests for each protection, and rerun the gate on the rebased head.

