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

### Requirement: Explicit MCP approval recovery
The host MCP SHALL offer approval recovery as a control tool with exact session identity, turn and expected revision. Its description SHALL state that the tool is for an explicit user request, changes monitoring state only and does not grant or deny Codex permission.

#### Scenario: Authorized recovery tool
- **WHEN** an authorized MCP client invokes recovery after reading a current session snapshot
- **THEN** it sends one guarded host command and reports its fixed result without device or provider permission effects

### Requirement: Guarded media tool bindings
Every configured device alias SHALL bind `_media_start` with a controller v1 `playlistId` and `_media_control` with a controller v1 playback `action`. Each call MUST submit exactly one `media.start` or `media.control` command through the existing owner with the original request ticket, configuration revision and generation. Inputs MUST reject target overrides, unknown fields and values outside the controller v1 schema. The owner MUST decide capability support; registration does not imply support.

#### Scenario: Saved playlist and playback actions
- **WHEN** an authorized client invokes either media tool with valid guards and inputs
- **THEN** the hub submits the corresponding command to the configured native identity and preserves the owner receipt in the reusable module's extension envelope

#### Scenario: Capability and guard rejection
- **WHEN** the owner rejects an unsupported capability, stale revision or stale generation
- **THEN** the tool reports that typed rejection without a retry or additional command

#### Scenario: Current permission checks
- **WHEN** a caller lacks control scope or device permission, including after permissions change in an existing MCP session
- **THEN** the media tools are excluded from discovery for that caller and direct calls cannot reach the controller

#### Scenario: Ambiguous media write
- **WHEN** the controller connection fails after dispatch
- **THEN** the tool reports `priorEffects: possible`, retains the original request ID and reports `retry: never-automatically` without another submission

#### Scenario: Explicit content mode
- **WHEN** a client discovers the media tools
- **THEN** their descriptions require explicit Media selection before Pixoo playback through the existing integration tools, and invoking a media tool never submits an additional mode or restoration command

### Requirement: Source-bound playback tools
When playback is configured, the hub MCP SHALL register a read-scope playback status tool and a control-scope playback command tool bound to the configured source ID. The status tool SHALL return the shared playback snapshot. The command tool SHALL take only a client-chosen request ID and an action, SHALL submit it through the shared playback commands for the bound source and SHALL NOT accept a source, endpoint or other target. Discovery and calls SHALL require the matching scope and the source ID in the credential's devices, checked on every call. A staged hub SHALL refuse commands. Known rejections SHALL report their code with no prior effects, an uncertain result SHALL report possible effects, and nothing SHALL retry automatically.

#### Scenario: Read and command the configured source
- **WHEN** a credential with read and control scope and the source ID in its devices calls the status tool and then the command tool with a declared action
- **THEN** the status tool returns the snapshot, the source receives exactly one command, and repeating the request ID returns the original receipt without another call

#### Scenario: Missing grant or scope
- **WHEN** a credential lacks the source ID in its devices, or lacks control scope for the command tool, including after credentials change in an existing session
- **THEN** the affected tools are excluded from discovery, direct calls return `forbidden`, and the source receives no command

#### Scenario: Rejected and uncertain commands
- **WHEN** the action is not declared, the source is not available, another command is running or the hub is staged
- **THEN** the tool reports the typed rejection with no prior effects and sends nothing; and when the source does not answer a sent command, the tool reports an uncertain outcome with possible effects and does not retry
