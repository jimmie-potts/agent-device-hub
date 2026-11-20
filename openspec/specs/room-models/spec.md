# room-models Specification

## Purpose

Let the owner inspect a private prepared room or furnished apartment model and select its configured lights through existing authenticated controls, while preserving truthful device evidence.

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

### Requirement: Shared apartment geometry and placements

The core SHALL serve a versioned apartment model whose rooms use existing room IDs and one apartment frame in meters. A plan calibration SHALL retain its reference measurement and orientation provenance. Room boundaries, floor elevations, walls and openings SHALL distinguish measured, inferred and unresolved geometry. Furniture, artwork and fixtures SHALL have stable IDs and placed dimensions and orientation. Clients SHALL be able to consume the semantic model without using the renderer. Existing room-model/1.0 reads and inspection SHALL remain supported.

#### Scenario: Calibrated whole apartment

- **WHEN** an authenticated reader opens the apartment prepared from a calibrated multi-room plan
- **THEN** every room and opening occupies its shared meter coordinates and the data retains its calibration, placement and uncertainty evidence

### Requirement: Preserve corrections through scan replacement

Preparation SHALL align each normalized room scan with an explicit rigid transform and preserve private original scans and preparation inputs. Replacing a scan SHALL update only the selected room's compatible geometry and transform. Existing room and structure IDs, other rooms, individual placed object IDs, positions and exact fixture bindings SHALL survive the update. Mismatched identities or conflicting placement geometry SHALL require correction before replacing the active model.

#### Scenario: Replace a room scan

- **WHEN** a corrected aligned scan for one room is prepared and published
- **THEN** the corrected geometry loads after restart while the originals, unrelated rooms, furniture and artwork placements and fixture bindings survive

### Requirement: Private apartment publication and artwork

The core SHALL expose only bounded versioned model data and referenced image renditions through authenticated content reads. Private source files and previous versions SHALL remain unserved. Publication SHALL validate all references and enforce model, image and decoded pixel budgets before replacing the active version under the state lease and expected identity. Failed validation or an interruption before replacement SHALL preserve the active model. An ambiguous completion SHALL be resolved by readback before trying again.

#### Scenario: Invalid or unreferenced artwork

- **WHEN** an asset is excluded from the active model, missing, externally referenced, unsafe, corrupt or oversized
- **THEN** it cannot be read as valid artwork, and failed publication leaves the prior model usable

### Requirement: Furnished apartment inspection

Rooms SHALL show whole-apartment and selected-room inspection with orbit, zoom, cutaway and an overhead camera, including touch on phone widths. Furniture, artwork and fixture locations SHALL be rendered from the semantic model. If artwork or WebGL is unavailable, the dashboard SHALL preserve useful room and fixture inspection and existing guarded lighting controls. Device observations SHALL remain distinct from schematic presentation and follow the existing exact fixture and command rules.

#### Scenario: Inspect and control through existing lighting

- **WHEN** the owner selects a fixture in the apartment, changes the camera, reloads or reconnects with stale or unknown device evidence
- **THEN** the view sends no device command, shows the available observation honestly and exposes individual writable controls only for a current uniquely owned member of that room

### Requirement: Reported anonymous apartment presence

The apartment SHALL consume the Presence Pro producer's public versioned SDK
records through the existing authenticated dashboard connection. While the
sensor layer is visible, explicitly mapped room/zone reports SHALL highlight
occupied if any contributor reports occupied, vacant only if all configured
contributors report vacant, and unknown otherwise. Separate contributors,
disagreements and unavailable sources SHALL be available in layer details.
Points SHALL use usable producer-projected apartment meters and remain approximate
anonymous source slots, with held/unknown-hold and last scalar receipt evidence.
Coordinates SHALL NOT establish room occupancy, person identity, measured height,
source freshness or physical precision. Connected silence SHALL preserve reports
without a TTL or interpolated motion. The renderer SHALL neither acquire sensor
data nor recalibrate, change prepared geometry or send commands.

#### Scenario: Connected reports and overlapping sources

- **WHEN** the layer is visible and mapped sources report occupied, vacant or unknown and optional approximate points
- **THEN** the apartment shows the combined reported room state and makes each source's receipt and hold limitations available, without fusing slots or summing overlapping counts

#### Scenario: Source or SDK loss

- **WHEN** a sensor disconnects/restarts or the dashboard copy loses synchronization
- **THEN** affected usable evidence becomes unknown and retained browser text is explicitly dated last-known, with no current marker, invented vacancy or replay

#### Scenario: Invalid projection or ambiguous boundary

- **WHEN** calibration or coordinates are unusable, or a point touches multiple room footprints
- **THEN** the view preserves available room reports and explains absent or ambiguous point presentation without choosing a room by array order

#### Scenario: No sensors or unavailable WebGL

- **WHEN** no presence sensors are configured or WebGL is unavailable on desktop or phone
- **THEN** room and fixture inspection remains usable, evidence has a text alternative and passive actions send zero device, speech or navigation commands

### Requirement: Optional Rooms sensor zone layer

The 3D apartment SHALL offer a sensor layer that starts hidden. The visible layer
SHALL show Couch and Kitchen work area, drawing controls for their floor rectangles
and a Pro 1 / Pro 2 / Both filter. The filter SHALL apply to marker visibility and
zone status based on usable points. Map-zone status SHALL distinguish tracked
points from absent or unavailable coordinates.

#### Scenario: Open and filter the layer

- **WHEN** the operator opens the 3D map and enables Sensors
- **THEN** the default map reveals the layer only on request and each source filter changes marker and zone tracking cues while preserving fixture controls

#### Scenario: Draw and recover a saved footprint

- **WHEN** the operator selects a named zone, picks two overhead corners inside a room and saves, then reloads
- **THEN** the browser privately retains the floor rectangle for that plan and displays it when Sensors is reopened

#### Scenario: Decline an unusable edit

- **WHEN** the operator cancels a draw, picks an invalid rectangle, or saving fails
- **THEN** the prior zone remains available and any corrective message appears only inside the active layer
