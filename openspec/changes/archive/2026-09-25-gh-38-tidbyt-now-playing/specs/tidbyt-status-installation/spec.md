## ADDED Requirements

### Requirement: Optional now-playing reads
The runner configuration MAY include a `nowPlaying` block naming a private read-token file, the playback source ID and optionally an installation ID that differs from the status installation (default `nowplaying`). With it, the runner SHALL read `/api/playback/v1/snapshot` from the same loopback hub with a 2.5 second deadline, a 64 KiB body bound and no redirects. It SHALL validate the envelope strictly, including the configured source ID, and SHALL start a now-playing publisher on the same controller. Without it, the runner SHALL create no playback reader or publisher. Failed or invalid reads SHALL reach the publisher as failed-read evidence, and the runner MUST NOT print playback data.

#### Scenario: Wrong source or malformed snapshot
- **WHEN** a playback read returns another source ID, an unknown availability, an oversized body or a failed HTTP response
- **THEN** the now-playing publisher receives a failed read and applies its stale rules

#### Scenario: Status-only configuration
- **WHEN** the configuration has no `nowPlaying` block
- **THEN** the runner reads only the sessions route and writes only the status installation

#### Scenario: Invalid now-playing configuration
- **WHEN** the `nowPlaying` block has an unknown key, an unsafe token file, an invalid source ID or the status installation's ID
- **THEN** startup fails before any network request with a fixed error code
