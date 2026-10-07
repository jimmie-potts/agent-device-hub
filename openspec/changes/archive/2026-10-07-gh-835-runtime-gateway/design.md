## Context

ADR 0012 puts every outside caller of the runtime behind one edge: remote parts over SSE and HTTP through the SDK, browsers and MCP clients through the same listener, with one error body and the existing authorization and origin checks (docs/sdlc.md, scope defaults). #883 built the SDK edge and #920 mounted it with a grants file, but its grants only name a source. The old Hub keeps 1 to 32 client credentials with `read`, `control`, `ingest` and `admin` scopes and device grants, browser sessions from a launcher and from trusted-loopback sign-in, an MCP route and an operator's approval recovery. #919 made one private configuration file the runtime's settings path and took module API 1.1.

## Goals / Non-Goals

**Goals:** every caller gets one error shape and the access checks it has today; a hook's credential can only publish lifecycle observations; the old Hub's credentials authenticate unchanged after an offline conversion; module manifests contribute pages, read tools and settings; operator recovery survives the cutover; every old route is accounted for.

**Non-Goals:** the dashboard (#922), hooks and Codex Desktop (#926), Wispr (#927), action routes and their dispatcher (#782), automation (#925), automatic token rotation, the supervised migration routes and the controller v1 proxy.

## Decisions

### One gateway, two callers

The listener keeps health's local-only rule. Every other route is the gateway's. A caller is a **client credential**, presented as a bearer token with no browser context (no `Origin`, no fetch metadata but `none`), or a **browser session**, carried by an `HttpOnly`, `SameSite=Strict` cookie that only this origin's pages may present; a change with it names this origin and carries `bunny-request: 1`, a header no other site can send without the gateway's leave. A cookie is the only way a navigated page and an `<img>` it loads can be authorized without putting a token in a URL. Alternative rejected: bearer tokens held by page script, as the old Hub's dashboard did, which cannot authorize a module page loaded by navigation or its content by reference.

### Scopes stay; the edge gets calls and keys

Credentials keep the Hub's scopes and device grants, so the conversion is exact and the HTTP routes check scopes as today. The SDK edge gains a generic per-grant permission, `calls` and routing-key `keys` (additive: either left out allows all), and the runtime maps scopes to it in one table: `read` subscribes and syncs every state and event key, `ingest` publishes the `lifecycle` family on `bunny.event.lifecycle.*` only, `control` requests the core's operator commands and its devices' commands, `admin` adds nothing. The stream and `close` need no permission, since a stream carries only what the part's other calls opened; that lets the SDK client connect for any grant. #782 can narrow device commands further when its dispatcher lands.

### Device grants narrow reads and commands (fix round)

The old Hub narrowed controller, integration, lighting, playback and Wispr reads, dashboard components and MCP device tools by device grant, so the runtime keeps that authority. The edge's grants gain `excluded` key patterns and `publishes` families. Every device an admitted module names that a grant does not is excluded as `bunny.*.*.<device>`: its records leave the caller's sync answers and their membership, its messages are never queued for the caller's subscriptions (through the SDK's new `accept(key)` filter, with every handler now told the key), and its commands are refused. This works because ADR 0012's routing-ID rule makes an entity's ID the last token of its keys, which the bus now enforces for commands on every transport (`invalid-message`) and the edge for remote publishes, so a key grant binds the subject a responder acts on. `/api/v2` reads filter the same records; a module's pages, content, settings and tools need a grant of every device the module names, which keeps a multi-device module's settings, such as device addresses, from a partial grant. Alternatives rejected: per-device filtering inside each contribution, which a module that ignored it would leak, and leaving reads open, which drops the old Hub's narrowing. A family no device keys, such as `session`, stays readable under `read`.

### Credentials file, digests, reload

The configuration's `edge` section names a private credentials file (`edge-credentials/1.0`) under #919's private-file rules; it holds token digests only, as the Hub does, so the file is not a token store and converted tokens keep working. `edge-grants.json` retires. SIGHUP or `Runtime.reload()` reads the file again: a revoked or changed credential's streams end and its next call is `unauthenticated`; a refused file keeps the old set. Manual grant, revocation and rotation are edits to the file (`grantCredential`, `revokeCredential`), which #926's setup authority composes. Writers hold the file's lock, take turns within one process, refuse a file changed since they read it (`configuration-changed`) and refuse another owner's ID or source (`edge-credential-conflict`), as the old setup authority did; a rotation revokes and grants. One source per credential, and `bunny/parts/dashboard` belongs to browser sessions. The SDK edge takes a host `authenticate` hook so the runtime owns authentication, and `disconnectPrincipal(id)` so it can end a revoked credential's streams.

### Duplicates, liveness

The edge remembers each command it dispatches, by source and message ID, and refuses the same message again with `duplicate-conflict`, before anything happens. `duplicate-conflict`'s registry meaning widens to cover a command sent again; a correct caller never re-sends a command (ADR 0012, "Retries"), so it is the right WARN-level code. The memory is bounded per source (1,024, and 65,536 in all, then that source's `capacity`), so one part cannot lock the others out; an entry lasts while the bus has the command and then until its expiry, at most 10 minutes; a command the bus refused before any responder had it is forgotten. It does not survive a restart; modules that must not repeat across restarts keep their own `requestId` memory, as the lamp does. A stream gets a heartbeat every 15 s, a stream whose socket stays full for 30 s is ended so its subscriptions free their queues, and the client takes 45 s of silence as a lost stream and resyncs. These liveness timers run on real timers by default, apart from the deadline scheduler, so virtual time in tests never trips them.

### Module API 1.2 contributions

`pages`, `content`, `tools` and `settings` join the manifest. They are functions on the manifest, as `configure` is, so a module's factory closes over its own state; there is no second context or registry. Settings show what `configure` accepted (one configuration path); changing them is editing the configuration file. Tools are read-only; their schemas must compile as strict JSON Schema 2020-12 at admission, so a bad schema refuses the module instead of failing MCP. Each contribution runs in the module's own flow, and an exception fails the module, as a handler's does. The gateway never serves a page, settings or tool answer that holds a secret a module read.

### MCP

`packages/mcp` is reused unchanged, and served only with the edge section's `mcp` set, as the old Hub's opt-in: each module with tools is a registration, its tools extensions named `<module>_<tool>`, and the core's registration adds `core_recover_approval`. A credential's MCP devices are the modules whose every device its grant names. A result is `{result}` and a refusal the shared error body under `data`; the package's own pre-dispatch refusal of malformed arguments keeps its `gateway-error` with the registry's `invalid-request`, and MCP protocol errors keep the MCP specification. The gateway refuses browser sessions and pages before MCP sees the request.

### Reads without polling

`/api/v2/families/<family>` answers from a sync copy the gateway keeps after the first read, so the owner's published changes keep it current and nothing polls. `/api/v2/snapshot` is ADR 0012's snapshot read API, the gateway's one-off sync and the ADR's second implementation for one process: one owner's current state at its revision, from a single sync, with no copy kept.

### Route map and records

`retired.ts` lists every old Hub route with its replacement or drop. A request to one answers `not-found` and is logged as `runtime.edge.refused` with `http.route`, the route template, never the path's values, and `http.request.method`. These attributes and `runtime.edge.reloaded` need the diagnostic contract's profile 1.4; no existing attribute could name a route without abusing its meaning.

## Boundaries and outcomes

- **Entry points:** the listener's gateway routes, the SDK edge, MCP, the launcher's socket, SIGHUP. Hand-offs: the core (approval recovery, sync), modules (contributions), #926 (credentials file), #935 (conversion), #922 (dashboard and launcher CLI), #782 (action tools and command narrowing).
- **Refusals** are typed and prove no effect: authentication, origin, scope and key checks, validation, an unknown route and a duplicate command are refused before anything reaches the bus or a module. **Outcomes:** approval recovery replies `accepted` once committed (no outcome follows, as for acknowledgments); a command whose fate the bus cannot know is `uncertain-result`; reads have no effect. Nothing is retried.
- **Codes:** from the registry; `duplicate-conflict` gains the repeated command; `unavailable` and `capacity` are the only retryable ones.
- **Records and traces:** refusals at their code's level with the repetition rule; one record per reload; stalled streams end with a WARN `edge.disconnected` with `capacity`. The bus keeps recording commands the gateway sends, in their own traces.
- **Faults:** a module that throws in a contribution fails alone; a module not running or not answering in 5 s is `unavailable`; a refused credentials file keeps the old set; a socket path too long refuses the start.

## Risks / Trade-offs

- A module's contributions need a grant of every device it names, so a partial grant loses a multi-device module's pages and tools; per-device contributions need a later module API.
- The `/api/v2` documents have no published schemas yet; #922, their first consumer, adds them.
- The command memory forgets at a restart; a raw client that repeats a command across a restart reaches the module, whose own duplicate handling applies.
- Browser sessions live in memory; a restart signs browsers out, as the Hub's did.
- MCP's malformed-argument refusals keep the package's `gateway-error` shape (with a registry code) because the package stays unchanged.
- The launcher socket can be off; disposable runs turn it off because their state directory is too deep for a Unix socket.
