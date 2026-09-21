# Standalone hub MCP specification

## Purpose

Provide local authenticated agent/session inspection and controller integration commands through the standalone hub, retaining the owning services' authority and evidence limits.

## Requirements

### Requirement: Optional local transport
The host SHALL expose MCP only when explicitly enabled, on its existing numeric-loopback listener, using the reusable MCP transport and current machine credentials. It MUST preserve Host, supplied-Origin, Fetch-Metadata, scope, device authorization and bounded admission checks.

#### Scenario: Disabled and hostile requests
- **WHEN** MCP is disabled or a request has invalid credentials, Host, Origin or scope
- **THEN** no tool action occurs and the request is rejected

#### Scenario: Credential replacement
- **WHEN** a credential is revoked or its permissions are narrowed
- **THEN** subsequent discovery, calls and replay use current permissions

### Requirement: Qualified session inspection and explicit commands
Session tools SHALL preserve Codex and Claude identities, activity, attention, notice acknowledgments, read evidence, observation freshness and collector health independently. Labels and exact-notice acknowledgments MUST call the same protected state commands and replay ledger as HTTP. Inspection, discovery and reconnect MUST NOT mutate task or device state.

#### Scenario: Read stale or unknown evidence
- **WHEN** a client inspects a session with stale or unavailable evidence
- **THEN** freshness and uncertainty remain explicit without inferring task success or readership

#### Scenario: Shared command identity
- **WHEN** HTTP and MCP submit the same state request identity and payload
- **THEN** the original result is reused, while changed payloads conflict and revoked callers cannot replay

### Requirement: Configured controller ownership
Discovery SHALL enumerate only authorized configured device aliases. Tools MUST bind server-configured native identities and call existing controller services. Optional power, brightness, mode and media commands MUST remain capability-gated by the owner. Declared integration settings MUST use the owning versioned extension.

#### Scenario: Independent controllers
- **WHEN** one controller is failing or busy
- **THEN** another authorized controller remains independently callable and unknown aliases cannot redirect requests

#### Scenario: Native identity and optional capability
- **WHEN** a configured alias differs from the native device ID or an optional operation is unsupported
- **THEN** native request and receipt identities remain unchanged and the owner reports unsupported capability without a new device writer

### Requirement: Replay, cancellation and uncertain effects
All commands SHALL preserve request IDs, revision and generation guards, native replay/conflict outcomes and possible prior effects. A disconnected or cancelled MCP delivery MUST NOT cancel admitted backend work or automatically retry an ambiguous write.

#### Scenario: Concurrent commands and disconnect
- **WHEN** MCP and HTTP contend for a native request or a client disconnects after dispatch
- **THEN** the existing bounded owner decides admission and replay, and backend work continues without another submission

### Requirement: Reproducible source qualification
The deliverable SHALL run both existing Codex/Claude protocol profiles and supported protocol versions against the standalone host with disposable storage and fake controllers, including unknown IDs, unsupported capabilities, concurrent callers, stale observations and controller failure. Its private archive MUST contain its dependency closure.

#### Scenario: Isolated consumer
- **WHEN** the archive is installed offline into a fresh consumer
- **THEN** the host MCP tests run without sibling checkouts, personal credentials, installed agents or physical devices
