## Why

The new runtime of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) serves remote parts through #883's SDK edge, but every granted part can call any key, its grants live in a state-directory file of their own, and nothing serves the old Hub's other callers: its client credentials with scopes and device grants, browser sign-in, MCP, `/api` reads and the operator's approval recovery. [Hub #835](https://github.com/jimmie-potts/agent-device-hub/issues/835) gives every outside caller of the runtime one error shape, one version rule and the same access checks, under [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md), before the cutover (#840) replaces the old Hub on its port.

## What Changes

- **A gateway on the runtime's listener.** With `--edge`, `apps/runtime/src/gateway/` serves every route but health: the SDK edge, `/api/v2` reads through SDK sync and the snapshot read API, the core's approval recovery, MCP, the modules' pages, content and settings, and browser sign-in. Every refusal is the shared error body with a registry code.
- **Callers keep the old Hub's scopes; device grants are dropped** (owner decision, 2026-10-07): no grant limits a client to some devices. Client credentials move into a private credentials file (`edge-credentials/1.0`, digests only) that the runtime configuration's new `edge` section names, replacing `edge-grants.json`. A browser session, opened by the launcher's code or a trusted loopback page, acts as the dashboard's grant, carried by an `HttpOnly`, `SameSite=Strict` cookie, with Origin, `Sec-Fetch-Site` and `bunny-request` checks. SIGHUP reloads the file for manual grant, revocation and rotation. An offline conversion carries the Hub's credentials, dropping their device grants and listing each credential it widened, and its `browserAccess`, `editorLinks` and `placeLinks`, for the installer (#935).
- **Per-grant calls and routing keys at the SDK edge (additive SDK change).** Each `RemoteEdge` grant may list the calls and key patterns it may use; the runtime derives them from scopes, so a hook's credential can only publish lifecycle observations. A host may authenticate calls itself. The edge refuses a token used under another declared source at connect, remembers sent commands until their expiry and refuses a repeat as `duplicate-conflict`, writes heartbeats and ends a stream whose reader stopped; the client reconnects after a silent stream.
- **Module API 1.2.** A manifest may contribute pages, content by reference, read tools and settings. Settings show what `configure` accepted, so a module keeps one configuration path. A 1.0 or 1.1 module still runs, and one that declares a contribution is refused.
- **Approval recovery as a 2.0 command.** A new core family, `approval-recover`, and the core's responder carry the old Hub's `recover-approval`; the gateway and MCP send it for an operator.
- **MCP on the runtime** through `packages/mcp` unchanged: the modules' read tools, the core's `core_sessions`, and `core_recover_approval`.
- **The route map** of every old Hub route, with its replacement or recorded drop. A request to one answers `not-found` and is logged with its route, under the diagnostic contract's new profile 1.4 (`http.route`, `http.request.method`, `runtime.edge.reloaded`).
- **Tiers.** The scenario catalog gains `gateway-reads`, `grants-and-duplicates`, `approval-recovery` and `module-contributions`, played by the in-memory harness, which now mounts the gateway, and by disposable runs, which seed their parts' credentials in the run's configuration file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: health's listener rules, module API 1.2 admission, the gateway in place of the bare SDK edge, the configuration's `edge` section, the credentials file, browser sessions, the `/api/v2` routes, MCP, module contributions, the route map, approval recovery, profile 1.4 records, the catalog's gateway scenarios and disposable runs on the configuration file.
- `bunny-sdk`: module API 1.2 contributions in the manifest checks, edge grants by calls and routing keys, a host's own authentication, declared sources, command memory and stream liveness.
- `bunny-message-profile`: the `approval-recover` core command family, and `duplicate-conflict` for a command sent again.
- `shared-observability-contract`: artifact 1.4.0 with profile 1.4.

## Impact

- **Code:** `packages/sdk` (`module.ts`, `remote-edge.ts`, `remote-client.ts`, `remote-protocol.ts`, `index.ts`); `packages/event-contracts` (the family, its schema and fixtures, the registry's meaning text); `packages/observability` (catalog, schema, fixtures, version 1.4.0); `apps/runtime/src` (new `gateway/`, `credentials.ts`, `convert.ts`; additive changes to `state.ts`, `host.ts`, `runtime.ts`, `process.ts`, `index.ts`, `record.ts`, `core/core.ts`); `apps/runtime/verify` (seed, adapter, supervisor, plugin) and `apps/runtime/scripts/measure-edge-memory.mjs`.
- **Coordinator-owned files:** `package-lock.json` (the observability version and the runtime's new `device-mcp` and `ajv` dependencies), `docs/development.md` (runtime checks).
- **Unchanged:** `packages/mcp`, the old Hub, the shipped module list, CI workflows and the root `package.json`.
- **Delivery:** source-only, verified in disposable runs; installation is the cutover's (#840), whose installer (#935) runs the conversion.
