## Purpose

Provide BUNNY's common interface for inspecting shared agent evidence and explicitly controlling supported device integration through the existing owners.

## ADDED Requirements

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
Each user-facing component SHALL use common identity, navigation, status, settings and capability/permission-driven controls with optional specialized views. Device status MUST distinguish selected mode, desired/pending state, last successful transmission, failures, freshness and external control. Missing evidence MUST remain unknown. Advanced-editor links MUST be validated and general controls and exact previews remain excluded.

#### Scenario: Heterogeneous components
- **WHEN** Nanoleaf, Pixoo and a third synthetic component declare different capabilities
- **THEN** each appears in common navigation with only supported authorized actions and explanations for unavailable operations

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
