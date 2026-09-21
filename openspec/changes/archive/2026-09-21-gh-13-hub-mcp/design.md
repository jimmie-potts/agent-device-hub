## Context

The host already owns credential verification, a shared state command ledger and one bounded HTTP client per configured controller. The reusable MCP module supports strict extension-only registrations. Native device IDs need not equal hub aliases and can repeat across distinct controllers. See proposal.md for motivation.

## Goals / Non-Goals

Preserve those existing owners while adding an opt-in protocol route. Do not add authentication code, a transport, a controller writer, a state reducer, general frontend, remote access or installation workflow.

## Decisions

- Mount the shared handler before HTTP body parsing, within the host's existing request and connection admission. Reuse the host's digest verifier for both transports. MCP maps only existing read/control scopes; ingest/admin do not implicitly grant them.
- Use extension-only registrations for configured aliases. Return validated native snapshots and receipts inside extension envelopes rather than rewrite IDs to satisfy generic shared-tool matching. Bind native selectors on the server. This also supports controllers with the same native device ID.
- Register one reserved logical host service, excluded from physical-device discovery. Existing host read/control authority permits its corresponding tools even with no configured devices. Reject alias collision with that reserved identity. No fake controller snapshot or device capability represents the host.
- Use stable tool prefixes derived from configured aliases, with bounded digest suffixes to prevent collisions and length overflow. Discovery returns the alias-to-tool mapping without querying controllers. Device-specific tool calls return owner capability/revision failures.
- Session reads and commands directly share host functions with HTTP. MCP string tickets use `request_id` and map to the owner's `requestId`, retaining uncertainty identity in the shared module. No quiesce/admin or ingest tool is added.
- Expose typed native integration edits and mode changes. No reusable Pixoo player/catalog service is registered by the standalone host; do not import controller source or invent a browser-token bridge. Media handlers remain unregistered until an owning machine adapter is available.
- Keep the shared three-second HTTP deadline, two-second controller deadline, 32 HTTP admissions and existing MCP bounds. Client cancellation controls delivery only. Catch only established pre-admission errors as no-effect rejections; ambiguous write failures retain possible prior effects.

## Risks / Trade-offs

- Alias/native confusion: bind selectors once and exercise differing and duplicate native IDs.
- Permission changes: verify current credentials on every MCP request and recheck the host principal before invoking shared services.
- Protocol disconnect after dispatch: retain owner work and original tickets; never install a client abort signal on a controller call.
- Packaging adds public MCP dependencies: bundle the exact local MCP archive closure and run offline installed tests.
- Bounded result delivery can reject large snapshots: retain shared response limits and return a failure rather than unbounded data or invented freshness.

## Migration Plan

Existing configurations remain MCP-disabled. A separately authorized owner can add `mcp: true` to private configuration and restart the same host. Disabling it removes only protocol access; state, controller ownership and backend work remain with existing owners. This source delivery performs no live migration.

## Assessment and verification

Complexity high because state and controller commands share concurrent admission/replay. Impact high because credential/device authorization and uncertain writes cross the new route. Uncertainty medium, bounded by existing source contracts and fake-backed host tests. Required inputs #5 and #7 are delivered in base 2c3bb4117bab0f845a95048b4ce72a49e915cfdc. Independent Standards and Specification reviews must inspect the same committed candidate, including authorization, cancellation and test quality.

The spec's transport and session requirements map to host protocol tests; controller ownership and uncertainty map to concurrent HTTP/MCP and fake failure tests; isolated-consumer acceptance maps to `test:hub:package`. Shared MCP, contract, build/type and workflow checks retain their existing gates. Installed clients, physical acceptance and public guide publication are excluded and must not be inferred from source evidence.
