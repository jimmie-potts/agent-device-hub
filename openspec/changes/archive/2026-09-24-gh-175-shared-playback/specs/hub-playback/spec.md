## ADDED Requirements

### Requirement: Source-independent shared playback
The hub SHALL keep shared playback separate from any source protocol. The shared module SHALL accept normalized observations and delegate commands only through the typed source interface, SHALL NOT import source-specific code or interpret source response fields, and SHALL expose snapshots and commands bound to a stable neutral source ID that is never derived from a receiver address. The first implementation SHALL run exactly one source, selected explicitly by configuration.

#### Scenario: Non-Sony source
- **WHEN** a fake source that is not Sony implements the source interface and reports an observation
- **THEN** the unchanged shared module serves its snapshot and routes an accepted command to it

#### Scenario: Invalid playback configuration
- **WHEN** configuration lists more than one source, selects a source it does not list, reuses a controller alias, or gives a Sony endpoint that is not a numeric private or loopback IPv4 `http` URL ending in `/sony`
- **THEN** the hub refuses to start

### Requirement: Observation freshness
The snapshot SHALL report the source ID, availability, the time and age of the last successful observation and the last observed playback. A successful read, including an unchanged one, SHALL refresh the observation time; a failed read SHALL NOT. Availability SHALL be `available` below 5 seconds of age, `stale` from 5 to under 30 seconds and `unavailable` at 30 seconds or more or before the first observation. An unavailable snapshot SHALL NOT report playback, and a missing observation SHALL NOT become paused or stopped.

#### Scenario: Startup
- **WHEN** the hub starts and the source has not yet been observed
- **THEN** the snapshot is unavailable with no observation time and no playback

#### Scenario: Unchanged reads
- **WHEN** the receiver returns the same track on consecutive reads
- **THEN** the observation time advances with each read and the source stays available

#### Scenario: Receiver stops answering
- **WHEN** reads fail or time out after a successful observation
- **THEN** the observation time does not change, the snapshot becomes stale and keeps the last playback, and after 30 seconds becomes unavailable with no playback

#### Scenario: Receiver answers again
- **WHEN** a read succeeds after a stale or unavailable period
- **THEN** the snapshot becomes available with the new observation

### Requirement: Sony HT-A9 source
The Sony source SHALL read `getPlayingContentInfo` from the configured receiver immediately and about every two seconds, with a 1.5-second timeout and no overlapping reads. It SHALL normalize the AirPlay entry's title, artist, optional album and playback status, SHALL declare pause, next and previous only while AirPlay is playing, and SHALL NOT declare play. It SHALL report a non-AirPlay input as inactive and SHALL NOT copy other receiver fields, including artwork URLs.

#### Scenario: AirPlay track playing
- **WHEN** the receiver reports AirPlay playing with title, artist and album
- **THEN** the snapshot shows those values, status `playing` and controls pause, next and previous

#### Scenario: Missing fields and paused playback
- **WHEN** the AirPlay entry lacks an album or reports `PAUSED`
- **THEN** the album is absent rather than empty, and a paused source declares no controls

#### Scenario: Another input
- **WHEN** the receiver reports no AirPlay entry
- **THEN** the source is available with status `inactive`, no metadata and no controls

#### Scenario: Receiver error
- **WHEN** the receiver returns a JSON-RPC error, an unexpected status or a malformed body
- **THEN** the read counts as failed and reports nothing

### Requirement: Source-bound playback commands
The hub SHALL accept a command only for the selected source when the caller has control scope and that source ID in its devices, the source is available and the action is among its current controls. It SHALL run one command at a time, SHALL send an admitted command to that source exactly once, SHALL return a receipt with the request ID and a `sent`, `failed` or `uncertain` outcome, and SHALL NOT redirect, retry or replay a command. Repeating a retained request ID with the same body SHALL return the original receipt without contacting the source; a different body SHALL be rejected.

#### Scenario: Authentication and authority
- **WHEN** a request lacks a valid token, the needed scope, the source ID in its devices or the mutation header
- **THEN** it is rejected and the receiver receives no command

#### Scenario: Unsupported or unavailable control
- **WHEN** a client requests play, pauses a source that is not playing, or commands a stale or unavailable source
- **THEN** the hub rejects it without contacting the receiver

#### Scenario: Unknown source or extra target
- **WHEN** a command names another source ID or includes fields such as an endpoint
- **THEN** it is rejected and nothing is sent to any address

#### Scenario: Duplicate next
- **WHEN** a client sends the same next request twice
- **THEN** the receiver receives one next call and both responses carry the same receipt

#### Scenario: Concurrent commands
- **WHEN** a second command arrives while one is in progress
- **THEN** the second is rejected with `capacity` and only the first reaches the receiver

#### Scenario: Uncertain result
- **WHEN** the receiver does not answer a command before its timeout
- **THEN** the receipt is `uncertain`, and repeating the request returns the same receipt without a second call

#### Scenario: Staged host
- **WHEN** the hub runs staged for migration
- **THEN** it serves playback snapshots and rejects playback commands
