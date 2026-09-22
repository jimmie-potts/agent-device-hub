# Unified dashboard specification

## Purpose

Provide BUNNY's common interface for inspecting shared agent evidence and explicitly controlling supported device integration through the existing owners.

## Requirements

### Requirement: Separate evidence and inspection
The dashboard SHALL expose provider/source identity, attributable parent/children, chosen labels, activity, attention, retained notices, read evidence, observation age and collector health separately. Opening, selecting, filtering and reconnecting MUST NOT mutate devices or mark chats read.

#### Scenario: Attention while work continues
- **WHEN** an active session has attention and an unread notice
- **THEN** activity, attention and notice are independently visible and selection sends no command

#### Scenario: No active task
- **WHEN** the snapshot contains no active sessions
- **THEN** component status and authorized integration controls remain available

### Requirement: Protected explicit integration commands
The dashboard SHALL submit only explicit supported integration operations through the protected owning services, retaining identity, request IDs and controller revision guards. It MUST preserve Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media meanings, show unsupported operations with reasons, and retain user drafts on conflict or uncertain results. Native controller credentials MUST remain server-side.

#### Scenario: Concurrent controller edits
- **WHEN** another client changes a controller after a draft begins
- **THEN** the draft remains visible and its stale revision cannot silently overwrite the new state

#### Scenario: Lost command result
- **WHEN** a submitted command loses its response
- **THEN** the result is uncertain and reconnect does not submit a replacement command

#### Scenario: Explicit notice acknowledgment
- **WHEN** the user acknowledges a retained notice for a configured consumer
- **THEN** only monitor acknowledgment changes and the UI does not claim provider readership or success

### Requirement: Component integration views
Each user-facing component SHALL use common identity, navigation, status, settings and capability/permission-driven controls with optional specialized views. Device status MUST distinguish selected mode, desired/pending state, last successful transmission, failures, freshness and external control. Missing evidence MUST remain unknown. Advanced-editor links MUST be validated and exact previews remain excluded. General controls appear in the same component view only for the capabilities the controller declares.

#### Scenario: Heterogeneous components
- **WHEN** Nanoleaf, Pixoo and a third synthetic component declare different capabilities
- **THEN** each appears in common navigation with only supported authorized actions and explanations for unavailable operations

### Requirement: General device controls
The dashboard SHALL offer screen power, brightness, saved-playlist selection and the declared playback actions inside a component's existing view when the controller v1 snapshot declares that capability and the credential has control scope. Each control MUST submit exactly one valid controller v1 command through the existing hub route with the observed request ticket, configuration revision and generation, and MUST show the receipt or typed failure with pending, conflict and uncertain states. A disabled control MUST name the missing capability, scope or mode. The dashboard MUST NOT change a mode as a side effect of another command, submit compound writes, restore a previous state automatically or retry an uncertain command.

#### Scenario: Declared capability with control scope
- **WHEN** the Pixoo snapshot declares power, brightness and media and the credential has control scope
- **THEN** the power, brightness, playlist and playback controls are enabled and each submits one guarded controller v1 command whose outcome is shown

#### Scenario: Missing capability or read-only credential
- **WHEN** a component does not declare a capability or the credential lacks control scope
- **THEN** the corresponding control is disabled with the missing capability or scope named, and the view remains usable with no observed sessions

#### Scenario: Stale revision and uncertain result
- **WHEN** another client changes the controller after a draft begins, or a submitted command loses its response
- **THEN** the draft is retained, the conflict or uncertainty is shown, the control stays locked after an uncertain result, and reconnect or resync replays no command

#### Scenario: Screen power semantics
- **WHEN** the user turns the Pixoo screen off or on
- **THEN** the command is submitted in Monitor or Media without changing the mode, and the view explains that screen-off pauses playback and screen-on does not resume it

### Requirement: Content controls gated by status presentation
The dashboard SHALL disable Pixoo playlist selection and playback actions while Pixoo presents agent status in Monitor or a mode change is pending, show the reason, and offer a one-click explicit switch to Media through the existing mode control. Returning to Monitor MUST use the existing mode control. Because the Pixoo controller does not declare controller v1 modes, the Pixoo mode control and the explicit switch SHALL submit the device-owned Pixoo integration extension's mode operation through the hub's existing integration route with that extension's request ID, configuration revision and generation guards; controllers that declare controller v1 modes keep the controller v1 mode command. Playlists SHALL be listed by controller-declared ID until the device-owned naming extension is consumed.

#### Scenario: Monitor gating with explicit switch
- **WHEN** Pixoo is in Monitor and the user activates the explicit switch
- **THEN** one mode command to Media is submitted, no playlist or playback command is sent, and the content controls become available only after the Media mode is observed

#### Scenario: Playback in Media
- **WHEN** Pixoo is in Media and the user selects a declared playlist ID or activates a declared playback action
- **THEN** exactly one media command for that ID or action is submitted and its receipt is shown without a mode change

### Requirement: Reconnect without losing intent
The dashboard SHALL obtain authoritative snapshots on resync or expired cursors, reject superseded results, bound reconnect work, preserve focus and drafts, and keep slow/offline device status independent.

#### Scenario: Reconnect during editing
- **WHEN** the stream disconnects or resyncs while a user edits a field
- **THEN** updated evidence appears without resetting the field or focus or replaying commands

### Requirement: Accessible verified candidate
The dashboard SHALL support keyboard navigation, readable contrast, reduced motion and narrow layouts. Verification SHALL use synthetic task bursts, two controller fixtures, concurrent frontend/MCP-equivalent commands and reconnect, retain latency measurements for Hub #30, and require explicit approval of the actual UI before merge.

#### Scenario: Synthetic acceptance
- **WHEN** the candidate is qualified without personal sessions or devices
- **THEN** browser evidence covers inspection without writes, controls, failures, responsive layout and accessibility separately from human and physical acceptance
