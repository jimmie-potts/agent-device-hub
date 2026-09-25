## ADDED Requirements

### Requirement: Now playing view
When the caller's credential grants the configured playback source, the dashboard SHALL offer a now-playing view for that source. It SHALL poll the playback snapshot and show the source ID, status, availability, observation age and the title, artist and album the source reports. It SHALL mark a stale snapshot, show no track for an unavailable source and explain an `inactive` source. A caller without the grant SHALL see no playback view. The first version is text only.

#### Scenario: Current track
- **WHEN** the source is available and playing with title, artist and album
- **THEN** the view shows them with status `playing` and the source ID

#### Scenario: Stale and unavailable source
- **WHEN** the snapshot becomes stale and later unavailable
- **THEN** the view marks the last values stale, then shows no track and says the source is unavailable

#### Scenario: No playback grant
- **WHEN** the credential does not grant the playback source
- **THEN** the navigation has no playback entry and the dashboard reads no playback snapshot

### Requirement: Source-bound playback controls
The now-playing view SHALL show a button only for an action that the latest snapshot declares, and only while the caller has control scope and the source is available. It SHALL name why other controls are missing: read-only access, a stale or unavailable source, or an action the source does not declare. While the source is paused it SHALL warn that the title may not change until playback resumes. Each activation SHALL read the snapshot again, then send at most one command bound to the displayed source ID with a new request ID. It SHALL show sent, refused and uncertain outcomes through the shared command lifecycle, lock after an uncertain result until an explicit reload and never retry automatically.

#### Scenario: Declared controls only
- **WHEN** a control-scoped caller views a playing source declaring pause, next and previous
- **THEN** exactly those buttons appear, play does not, and pressing Next sends one next command for the displayed source

#### Scenario: Paused source
- **WHEN** the source is paused and declares next and previous
- **THEN** Next and Previous appear without Pause, with a note that the title may lag until playback resumes

#### Scenario: Read-only caller
- **WHEN** a read-only caller views the source
- **THEN** no control buttons appear and the view says the credential is read-only

#### Scenario: Control no longer declared
- **WHEN** the fresh read before sending no longer declares the action or the source is no longer available
- **THEN** nothing is sent and the view names the reason

#### Scenario: Uncertain command
- **WHEN** the hub reports an uncertain playback result
- **THEN** the view says the result is unknown, locks the controls until an explicit reload and sends nothing more
