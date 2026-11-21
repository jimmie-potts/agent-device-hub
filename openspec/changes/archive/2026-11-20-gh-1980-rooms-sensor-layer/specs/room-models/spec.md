## MODIFIED Requirements

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

## ADDED Requirements

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
