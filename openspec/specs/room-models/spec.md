# room-models Specification

## Purpose

Let the owner inspect a private prepared room model and select its configured lights through existing authenticated controls, while preserving truthful device evidence.

## Requirements

### Requirement: Private prepared models
The runtime SHALL serve bounded, versioned room-model metadata and geometry through authenticated core content reads. Original scans, calibration, anchor labels and real bindings SHALL remain in private owner-controlled storage outside source and build output. Reads SHALL accept only fixed model references, refuse links, unsafe permissions, malformed geometry and excessive sizes, and expose no local paths or raw errors.

#### Scenario: Private model loads for its room
- **WHEN** an authenticated reader opens a configured room with a valid prepared model
- **THEN** its geometry, measured-wall calibration and fixture anchors are available without any device command

#### Scenario: Unsafe or unavailable model
- **WHEN** a model is missing, malformed, oversized, linked outside its private folder or read without authentication
- **THEN** the read is refused with the existing shared error contract and the dashboard retains its ordinary room controls

### Requirement: Exact fixture selection
Each fixture SHALL retain a separate label, mesh-group anchor and optional stable device/owner binding. Selection SHALL resolve that binding against unique current device ownership and the room's current assignments before exposing its existing individual lighting controls. Unbound, missing, ambiguously owned or reassigned devices SHALL remain visible with a reason and without writable controls.

#### Scenario: Bound fixture selected
- **WHEN** the owner selects an anchor whose configured device and owner uniquely match current room membership
- **THEN** its existing light controls target only that device, with the anchor's display label

#### Scenario: Binding no longer matches
- **WHEN** the device is absent, duplicated, moved to another room or belongs to a different owner
- **THEN** selection cannot send a command and explains why the binding is unavailable

### Requirement: Truthful reported lighting and recovery
The room view SHALL follow current SDK device evidence and expose observed power and brightness only when known and fresh. Neutral model materials SHALL not imply captured scene colors are current telemetry. Existing capabilities, mode/hold guards, retained request identity and uncertain outcomes SHALL govern explicit controls. Loading, orbiting, selecting, refreshing, reload and reconnect SHALL send no light command and SHALL never replay an earlier command.

#### Scenario: Explicit supported control
- **WHEN** the owner explicitly uses an enabled supported control for a selected fixture
- **THEN** the existing tracked action path sends one request to its configured owner and reports the existing outcome evidence

#### Scenario: Stale evidence or uncertain result
- **WHEN** the stream becomes stale or a command reply is lost and the page reloads or reconnects
- **THEN** status remains honestly stale or uncertain, controls retain their existing locks and no command is replayed

### Requirement: Usable room inspection
The dashboard SHALL provide pointer/touch orbit and zoom, keyboard-accessible camera and fixture selection, cutaway inspection, an accessible status alternative and a fallback when WebGL is unavailable. Placement and calibration SHALL survive reload through private durable model data. Desktop and phone layouts SHALL retain visible controls without horizontal overflow.

#### Scenario: Inspect without WebGL
- **WHEN** 3D rendering is unavailable
- **THEN** fixture selection and existing guarded light controls remain usable with a clear model-view fallback
