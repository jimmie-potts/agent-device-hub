## ADDED Requirements

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
