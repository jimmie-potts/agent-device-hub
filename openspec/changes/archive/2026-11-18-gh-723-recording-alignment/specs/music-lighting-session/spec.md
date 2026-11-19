## ADDED Requirements

### Requirement: Admit measured shows with verified playback

Measured playback SHALL require an explicit start for one light in Free mode, an immutable saved show version, and fresh evidence tying playback of the scoped Music item to the show timeline. A mismatch, unsupported alignment, or stale evidence SHALL prevent the light from starting and return the applicable shared refusal. The session SHALL honor manual takeover, alert, Stop, and source loss under the existing restoration policy. Reconnect or restart SHALL send no Start and replay no cues.

#### Scenario: Different item with matching display metadata

- **WHEN** a requested measured show has the same displayed song and artist as playback but the scoped Music item does not match
- **THEN** the start is refused and the device is not addressed

#### Scenario: Another source takes over

- **WHEN** a running measured show loses its qualified playback source
- **THEN** the show ends under the existing restoration policy and does not restart on later evidence
