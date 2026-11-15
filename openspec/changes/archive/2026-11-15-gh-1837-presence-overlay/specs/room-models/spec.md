## ADDED Requirements

### Requirement: Reported anonymous apartment presence

The apartment SHALL consume the Presence Pro producer's public versioned SDK
records through the existing authenticated dashboard connection. Explicitly mapped
room/zone reports SHALL highlight occupied if any contributor reports occupied,
vacant only if all configured contributors report vacant, and unknown otherwise.
Separate contributors, disagreements and unavailable sources SHALL remain visible.
Points SHALL use usable producer-projected apartment meters and remain approximate
anonymous source slots, with held/unknown-hold and last scalar receipt evidence.
Coordinates SHALL NOT establish room occupancy, person identity, measured height,
source freshness or physical precision. Connected silence SHALL preserve reports
without a TTL or interpolated motion. The renderer SHALL neither acquire sensor
data nor recalibrate, change geometry or send commands.

#### Scenario: Connected reports and overlapping sources

- **WHEN** mapped sources report occupied, vacant or unknown and optional approximate points
- **THEN** the apartment shows the combined reported room state and each source's receipt and hold limitations, without fusing slots or summing overlapping counts

#### Scenario: Source or SDK loss

- **WHEN** a sensor disconnects/restarts or the dashboard copy loses synchronization
- **THEN** affected usable evidence becomes unknown and retained browser text is explicitly dated last-known, with no current marker, invented vacancy or replay

#### Scenario: Invalid projection or ambiguous boundary

- **WHEN** calibration or coordinates are unusable, or a point touches multiple room footprints
- **THEN** the view preserves available room reports and explains absent or ambiguous point presentation without choosing a room by array order

#### Scenario: No sensors or unavailable WebGL

- **WHEN** no presence sensors are configured or WebGL is unavailable on desktop or phone
- **THEN** room and fixture inspection remains usable, evidence has a text alternative and passive actions send zero device, speech or navigation commands
