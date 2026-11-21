## MODIFIED Requirements

### Requirement: Reported anonymous apartment presence

The apartment SHALL consume the Presence Pro producer's public versioned SDK
records through the existing authenticated dashboard connection. While the
sensor layer is visible, explicitly mapped room/zone reports SHALL highlight
occupied if any contributor reports occupied, vacant only if all configured
contributors report vacant, and unknown otherwise. Separate contributors,
disagreements and unavailable sources SHALL be available in layer details.
Individual sensor-layer points SHALL use usable producer-projected apartment
meters and remain approximate anonymous source slots, with held/unknown-hold
and last scalar receipt evidence.
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

### Requirement: Approximate combined presence dot

With the Sensors layer hidden, the apartment SHALL display a single anonymous
dot at the midpoint of two compatible source points. Each of the two connected
Pros SHALL have one usable calibrated point in the same uniquely mapped room.
The inputs SHALL pass the distance and receipt-time limits for this view.
A known held point is ineligible. The estimated midpoint SHALL resolve to that
same room. The combined estimate SHALL expire when the inputs leave those
limits. It SHALL NOT establish identity, occupancy or measured accuracy.

#### Scenario: Two compatible projections

- **WHEN** both Pros have nearby current points and each supplies one usable candidate
- **THEN** the Dollhouse and Overhead views display one combined dot at their midpoint

#### Scenario: Incompatible or expired projections

- **WHEN** a compatible pair is unavailable because of geometry, multiple candidates, known hold, stale receipts or connection loss
- **THEN** the default view has no combined dot and the Sensors layer can still show its source evidence under its existing rules

#### Scenario: Inspect source dots

- **WHEN** the operator opens the Sensors layer during compatible overlap
- **THEN** the individual source filters replace the combined dot with the selected source points and closing the layer restores any eligible combined dot
