## Context

The design baseline is hub revision `589846bcbe6a4a06ef6aaec9d2952c9f9d58dac3`. The repository implements pure controller contracts and consumers. It has no runtime controller service or MCP server. See proposal.md for the requested outcome and docs/controller-contract.md for the authoritative wire rules.

Controller-contract artifact 1.0.0 is released privately at tag `controller-contracts-v1.0.0`, with archive SHA-256 `5e0b30ac92e6e8e1e38d8249b740b565de66e3cc810a04bc6fac23e182e84e87`. The module must consume that API without changing its strict schemas or reference semantics.

Design is required by the spec-driven schema because this change adds a cross-repository package, an SDK dependency, authentication, concurrency and recovery behavior.

## Goals / Non-Goals

The package adapts MCP requests to configured owning services. The embedding application owns the listening socket, enablement, private credentials and device adapters. Controllers own atomic admission, revisions, replay, queueing, cancellation generations and physical transport. MCP owns protocol sessions and response delivery only.

The module has no `listen()` call, installed service, discovery scan, raw device transport, agent-state reducer, shared database access or playback scheduler. Protocol fixtures run with fakes on ephemeral loopback servers. They are not installed-client or physical verification.

## Decisions

### SDK and protocol

Pin `@modelcontextprotocol/sdk` to `1.30.0` and its required schema peer `zod` to `4.5.4`, with transitive versions locked. Use Node 24. The published SDK 1.30.0 archive contains an MIT LICENSE and declares Node >=18. Its archive SHA-256 is `2cac3f3e38fec2815ed9efafa2947faf8c6957310684f99703f3d180f3e9af1a`; npm integrity is recorded in package-lock.json. Preserve the shipped license in the distribution's third-party notices.

Qualify MCP `2025-11-25`, plus `2025-06-18` only when the same fixture suite passes. Reject unsupported negotiated versions before tool execution. Use the SDK's low-level `Server`, tool request schemas and Node `StreamableHTTPServerTransport`, so published JSON Schemas can reuse the strict delivered contract definitions.

The official SDK now has stable v2.0.0 and supports the 2026-07-28 protocol. That protocol removes initialization-based sessions and changes HTTP cancellation. Choose the maintained v1 line for this issue's explicit initialization contract. Do not describe it as the latest SDK or claim modern-protocol compatibility. Revisit the pin before its maintenance window ends. [SDK release-line policy](https://github.com/modelcontextprotocol/typescript-sdk), [v1 source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), [2026 transport changes](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

Use bounded stateful SDK sessions to support initialization and explicit request cancellation. The module assigns random session IDs, associates each session with its authenticated principal, and rejects use by another principal. Every HTTP request authenticates again. Sessions contain no device receipt cache. Return JSON responses and reject GET streams with 405 in this version. No event store, SSE replay, server-initiated sampling, resources, prompts or task execution is advertised. This is permitted by the selected transport, whose GET stream is optional. [2025 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

### Registered services and tool binding

Freeze a registry when creating a handler. Registration supplies `controllerId`, `deviceId` and a `ControllerService`. Reject duplicate IDs, missing default IDs and invalid tool prefixes at construction. Runtime calls can select only an explicit registered device ID. They never supply a controller URL, IP, path, credential or raw command.

`createDeviceTools(registry)` provides `device_list`, `device_status`, `device_power_set` and `device_brightness_set`. Discovery lists configured neutral IDs and optional operator-chosen labels for devices authorized for the caller. Status returns the controller snapshot. Setters accept a registered `deviceId` plus the controller-issued request ticket, expected configuration revision, expected generation and typed value. The module fills controller ID and API version from the registration and contract.

`bindDeviceTools(registry, {deviceId, prefix})` provides named status/power/brightness tools with the target fixed in server configuration and absent from their argument schemas. The same registration, authorization, validation and result implementation backs both forms. Device applications may compose their own typed tools using exported binding/result helpers, but this issue does not implement device-specific media operations.

Downstream review confirmed that Pixoo's existing player uses its own `request_id`, catalog results and media policy. Its generic machine API remains Pixoo #37 scope. Therefore a registration may supply strict named service extensions without a shared controller service. `bindServiceTools(registry, {deviceId, bindings:[{extension,name}]})` maps these extensions to exact local names such as `get_status` and `set_screen`. Each registered extension supplies strict input/output schemas, current read/control scope, annotations and its owning application operation. It receives the fixed target authorization context, keeps its existing request replay and returns `{kind:"extension",data}` without a fabricated shared Snapshot or Request. Generic tools require a shared service and omit extension-only targets. This clarifies the reusable binding requirement without changing controller API 1.0 or implementing device-specific behavior in Hub #7.

Tool schemas reject unknown fields and unsafe integers. Brightness is an integer from 0 through 100. The owning service checks current capabilities at admission. A supported capability may change after discovery; this yields the controller's current unsupported/conflict result, never a fallback raw operation. A status read preserves unknown observation, observation age, desired state, pending work and last successful transmission separately.

### Command boundary and results

`ControllerService.readSnapshot(context)` returns a validated API 1.0 Snapshot. `ControllerService.submit(request, context)` invokes the same admission service as browser/HTTP commands and returns a tagged controller result. Context contains authenticated principal facts and scoped authorization, never the bearer credential. An adapter to a remote controller uses its own server-configured machine credential.

The module does not call the pure reference `admit()` function as a second ledger. The owner serializes reservation and executes at most once. It receives unchanged request ticket, expected configuration revision, expected generation and command values. JSON-RPC request IDs identify RPC responses only and must not replace controller request tickets.

A command result is either a validated authoritative receipt, a definite rejection before admission, or an unavailable/uncertain adapter result. Preserve authoritative receipts exactly, including failure, priorEffects and operation lists. A timeout after dispatch without an authoritative receipt returns a gateway failure with the original request ticket, `priorEffects: "possible"` and `retry: "never-automatically"`. It must not invent receipt revisions, claim failure before effects, generate another request ticket or retry. Errors before dispatch use `priorEffects: "none"`. Unknown exceptions after dispatch are conservatively uncertain.

Return schema-valid structured content and matching serialized JSON text. Mark failed, partially-applied, uncertain and cancelled controller results as `isError: true`; queued and sent are accepted results with their exact outcome. Queued never means physically complete. Malformed RPC/unknown methods use protocol errors, while valid calls that fail admission or execution return tool errors. [Tool result and error rules](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### Cancellation and recovery

Check an explicit MCP cancellation signal before dispatch. Once the owning service receives a command, protocol cancellation stops waiting/delivery only. Do not pass the client signal into admitted controller work. Generation cancellation remains the owner's authoritative rule, and cancelled/partial outcomes retain known or possible prior effects. [Cancellation rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

Do not treat socket close, session expiry, DELETE, module close or credential revocation as playback stop. These terminate MCP delivery or prevent new work. Already admitted work remains owned by the backend and can finish or be cancelled by its own generation policy. A later client reads a fresh snapshot or explicitly resubmits the exact old controller request identity for lookup/replay. Neither action creates an automatic retry with a fresh ticket.

Two MCP clients, or browser and MCP clients, may race with one advertised next ticket. The owning admission service decides join/replay/conflict. The module must preserve that result, including receipt eviction and expired-epoch rejection. Historical receipts cannot restore a prior generation or ownership mode.

### Authentication and bounds

The module accepts a credential verifier supplied by the owning host and provides a bounded bearer-header extraction and verification wrapper. No default credential, browser-token fallback, query-string credential or auto-provisioning exists. A verifier returns a principal ID plus current machine credential status, allowed device IDs and read/control scopes. Revoked/invalid credentials fail before session use, discovery, replay or controller reads. Rotation overlap exists only when the verifier explicitly declares it.

Validate actual Host authority against explicit allowed host-and-port values. Ignore forwarded-host overrides. Missing, duplicated, malformed, suffix-matching or unconfigured Host values reject. Validate every supplied Origin against an exact scheme/host/port allowlist; absent Origin is acceptable only with a valid machine credential. Reject `null`, malformed, duplicate or unconfigured Origins. Retain an embedding host's stricter Fetch-Metadata policy, with cross-site requests rejected by default. The module's Node handler sees the original headers and bytes before a host body parser. Parent applications must mount it accordingly.

Defaults are 64 KiB JSON input, 32 admitted HTTP operations, 16 sessions, a five-minute idle session lifetime, one-second authentication deadline and ten-second RPC response deadline. Use a finite configurable maximum of 64 registered devices and a 1 MiB serialized response bound. Parse and serialize only within those limits. GET streams are disabled, so max active MCP streams is zero. Controller-advertised queue/replay/feed limits remain the controller's values; do not overwrite its Snapshot.limits with transport limits.

Count authentication attempts before awaiting the verifier. On timeout abort verification and reject the request. Retain the occupied verification slot until its promise settles, so a verifier ignoring abort cannot create unbounded pending promises. Account for admitted controller operations until they settle even after the RPC response deadline. Bound request-body wait time and session creation before SDK allocation. Capacity failures happen before new command dispatch. Authentication precedes schema details and cached receipt content. No token or private request body enters logs or tool results.

Read tools use `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`. Write tools use `readOnlyHint: false`, `destructiveHint: true` and conservative `idempotentHint: false`. All tools use `openWorldHint: true` because registered services may reach external physical devices. Descriptions explain replay via exact request identity and prohibit inferring optical state or task success. Hints never grant permission or weaken server authorization.

### Private distribution

Create `@jimmie-potts/device-mcp` version 1.0.0 as one private npm archive. Stage the already verified controller-contract 1.0.0 artifact and bundle it as `@jimmie-potts/device-contracts`, preserving its manifest and original files. Public SDK/schema dependencies remain exact normal dependencies with lockfile integrity. Do not publish a public npm package or fetch a mutable branch.

The archive contains compiled ESM, declarations, strict schema material, fixture corpus, package manifest, consumer documentation and third-party notices. Its manifest hashes shipped files and records contract version and upstream contract checksum. Record the MCP archive checksum and immutable source revision outside that revision in the private release receipt, avoiding a self-referential checksum. The coordinator publishes only after normal review/merge/CI gates.

At downstream adoption, the authorized coordinator downloads the immutable private release once, verifies it, and commits the reviewed archive and provenance receipt under the consumer's vendor directory. The consumer pins a `file:vendor/...tgz` dependency. Consumer CI installs from its own repository and normal public npm access; it needs no new cross-repository secret. Source packaging tests install outside the hub checkout with no sibling paths. This deliberately carries a small private binary artifact in each existing private consumer repository and preserves its source/version/checksum provenance.

## Risks / Trade-offs

- The maintained v1 SDK is a compatibility choice with a finite maintenance window. Record the pin and protocol matrix; upgrades must rerun the full suite and preserve command ownership.
- Long-running or hung controller/verifier callbacks consume bounded admission slots. Reject later work at capacity rather than allowing unlimited detached operations. Read status after recovery.
- Local HTTP bearer credentials depend on the explicitly configured same-machine route. The package defaults to loopback guidance and creates no broad listener or tunnel.
- A client may retry independently. Explicit controller identities and the owning ledger keep exact duplicates from repeating effects, but a new identity represents a new deliberate command. Tool descriptions must explain this.
- Fake protocol clients prove protocol shapes and module behavior. They cannot establish installed Codex/Claude versions, approval UX, real credentials, Windows/WSL reachability or visible hardware results.

## Migration Plan

No installed runtime changes occur. Add the package and source tests, then publish the verified private artifact after delivery gates. Pixoo #24 embeds the handler into its existing backend and registers its existing service. Nanoleaf #33 owns any Node embedding entry point and fixed-target HTTP adapter to Nanoleaf #28's Python machine API. Neither consumer imports sibling checkout internals or opens the other process's database.

Rollback disables the optional MCP route or restores the previous pinned archive. It does not revert controller state, restart playback or change device ownership. Installation and physical acceptance remain separately authorized in the device repositories.
