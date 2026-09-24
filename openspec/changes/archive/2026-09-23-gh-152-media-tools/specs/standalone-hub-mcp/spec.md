## ADDED Requirements

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
