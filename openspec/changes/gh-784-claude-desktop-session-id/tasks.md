## 1. Contract

- [ ] 1.1 Record failing lifecycle 1.2 tests, then add the 1.2 schema, TypeScript/Python validators and the shared accept/reject corpus; both language suites pass.

## 2. Producer

- [ ] 2.1 Record failing provider and hook-process tests for Desktop, CLI, missing, malformed, oversized, throwing, child, Codex and older-version cases, then implement the gated environment read with trimming order.
- [ ] 2.2 Accept `lifecycleVersion:"1.2"` in setup, staged producers and both hook entry points, with setup and packaged-hook tests.

## 3. Owner and feed

- [ ] 3.1 Record failing owner tests, then implement the memory-only map with snapshot 1.3, unchanged default projections, `/clear` as a separate record, retirement, expiry and restart behavior.
- [ ] 3.2 Prove durable export and reopen are unchanged: the new owner writes, the stored 2.1 rules reopen, and the on-disk bytes contain no `hostSessionId`.
- [ ] 3.3 Serve `snapshotVersion=1.3` on the session route and in `hub_sessions`, with HTTP and MCP tests and unchanged older projections.

## 4. Delivery

- [ ] 4.1 Update contract, provider-qualification, package, Hub and setup docs and package versions without replacing published bytes.
- [ ] 4.2 Pass the required build, type, contract, lifecycle, state, Hub, setup, MCP, package and workflow checks.
- [ ] 4.3 Synchronize affected specifications and archive the change on the delivery branch; installed observation stays with the issue.

Source acceptance: fixtures and local checks cover the contract, producer, owner, routes and setup. Installation through the guarded upgrade (blocked by #794), lifecycle 1.2 selection for the installed Claude producer and the installed Desktop observation remain issue gates outside these tasks.
