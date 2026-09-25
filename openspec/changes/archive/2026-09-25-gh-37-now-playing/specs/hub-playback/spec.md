## MODIFIED Requirements

### Requirement: Sony HT-A9 source
The Sony source SHALL read `getPlayingContentInfo` from the configured receiver immediately and about every two seconds, with a 1.5-second timeout and no overlapping reads. It SHALL normalize the AirPlay entry's title, artist, optional album and playback status. It SHALL declare pause, next and previous while AirPlay is playing, SHALL declare only next and previous while AirPlay is paused, SHALL declare no controls in any other status and SHALL NOT declare play. It SHALL report a non-AirPlay input as inactive and SHALL NOT copy other receiver fields, including artwork URLs.

#### Scenario: AirPlay track playing
- **WHEN** the receiver reports AirPlay playing with title, artist and album
- **THEN** the snapshot shows those values, status `playing` and controls pause, next and previous

#### Scenario: Missing fields and paused playback
- **WHEN** the AirPlay entry lacks an album or reports `PAUSED`
- **THEN** the album is absent rather than empty, and a paused source declares only next and previous

#### Scenario: Stopped or unknown playback
- **WHEN** the AirPlay entry reports `STOPPED` or an unrecognized state
- **THEN** the source declares no controls

#### Scenario: Another input
- **WHEN** the receiver reports no AirPlay entry
- **THEN** the source is available with status `inactive`, no metadata and no controls

#### Scenario: Receiver error
- **WHEN** the receiver returns a JSON-RPC error, an unexpected status or a malformed body
- **THEN** the read counts as failed and reports nothing
