## MODIFIED Requirements

### Requirement: Source-independent shared playback
The hub SHALL keep shared playback separate from any source protocol. The shared module SHALL accept normalized observations and delegate commands only through the typed source interface, SHALL NOT import source-specific code or interpret source response fields, and SHALL expose snapshots and commands bound to one stable neutral playback ID configured as `playback.id`, which is never derived from a receiver address and never changes with the presented source. Configuration SHALL list one or two sources in preference order, at most one of each kind, without per-source IDs; the hub SHALL poll every configured source.

#### Scenario: Non-Sony source
- **WHEN** a fake source that is not Sony implements the source interface and reports an observation
- **THEN** the unchanged shared module serves its snapshot and routes an accepted command to it

#### Scenario: Invalid playback configuration
- **WHEN** configuration uses the former `selected` form, lists no source or more than two, repeats a kind, reuses a controller alias or `hub-service` as the ID, uses an address-shaped ID or one containing an endpoint address, or gives a Sony endpoint that is not a numeric private or loopback IPv4 `http` URL ending in `/sony` or a Sonos endpoint that is not such a URL ending in `/MediaRenderer/AVTransport/Control`
- **THEN** the hub refuses to start with `invalid-playback`

### Requirement: Observation freshness
Each source SHALL keep its own observation record. The snapshot SHALL report the playback ID and the presented source's availability, the time and age of its last successful observation and its last observed playback. A successful read, including an unchanged one, SHALL refresh that source's observation time; a failed read SHALL NOT. Availability SHALL be `available` below 5 seconds of age, `stale` from 5 to under 30 seconds and `unavailable` at 30 seconds or more or before the first observation. An unavailable snapshot SHALL NOT report playback, and a missing observation SHALL NOT become paused or stopped.

#### Scenario: Startup
- **WHEN** the hub starts and no source has yet been observed
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

#### Scenario: Independent freshness
- **WHEN** one source stops answering while another keeps reporting
- **THEN** only the silent source's record ages, and the other source's observation time keeps advancing

### Requirement: Source-bound playback commands
The hub SHALL accept a command only when its `sourceId` equals the playback ID, the caller has control scope and that ID in its devices, the presented source is available and the action is among the presented source's current controls. It SHALL run one command at a time across all sources, SHALL send an admitted command to the presented source exactly once, SHALL return a receipt with the request ID, the playback ID and a `sent`, `failed` or `uncertain` outcome, and SHALL NOT redirect, retry or replay a command. Repeating a retained request ID with the same body SHALL return the original receipt without contacting any source; a different body SHALL be rejected.

#### Scenario: Authentication and authority
- **WHEN** a request lacks a valid token, the needed scope, the playback ID in its devices or the mutation header
- **THEN** it is rejected and no source receives a command

#### Scenario: Unsupported or unavailable control
- **WHEN** a client requests an action the presented source does not declare, or commands while the presented source is stale or unavailable
- **THEN** the hub rejects it without contacting any source

#### Scenario: Unknown source or extra target
- **WHEN** a command names a source kind, a former source ID or any value other than the playback ID, or includes fields such as an endpoint
- **THEN** it is rejected and nothing is sent to any address

#### Scenario: Duplicate next
- **WHEN** a client sends the same next request twice
- **THEN** the presented source receives one next call and both responses carry the same receipt

#### Scenario: Concurrent commands
- **WHEN** a second command arrives while one is in progress
- **THEN** the second is rejected with `capacity` and only the first reaches a source

#### Scenario: Uncertain result
- **WHEN** the presented source does not answer a command before its timeout
- **THEN** the receipt is `uncertain`, and repeating the request returns the same receipt without a second call

#### Scenario: Staged host
- **WHEN** the hub runs staged for migration
- **THEN** it serves playback snapshots and rejects playback commands

#### Scenario: Command after the presented source changed
- **WHEN** a client read the Sonos controls, the rule then presents the Sony, and the client sends play
- **THEN** the hub answers `unsupported-control` and sends nothing to either source

## ADDED Requirements

### Requirement: Source preference
The hub SHALL present, for each snapshot and command, the first source in configured order with the highest rank, where a source ranks first by reporting a session (a retained observation with status `playing` or `paused`), then by freshness class (`available` over `stale` over `unavailable`), then by configured order. The hub SHALL NOT expose which source is presented in the 1.0 snapshot and SHALL NOT change the playback ID when the presented source changes.

#### Scenario: Move alone
- **WHEN** the Sonos source reports playing and the Sony source reports inactive
- **THEN** the snapshot shows the Sonos observation under the playback ID

#### Scenario: Grouped speakers
- **WHEN** both sources report playing and the Sonos source is listed first
- **THEN** the snapshot shows the Sonos observation and a pause goes only to the Sonos source

#### Scenario: Sony alone
- **WHEN** the Sonos source reports inactive and the Sony source reports playing
- **THEN** the snapshot shows the Sony observation and a next goes only to the Sony source

#### Scenario: Move offline mid-song
- **WHEN** the Sonos source was playing and stops answering while the Sony source keeps reporting inactive
- **THEN** the snapshot stays on the Sonos observation as stale for up to 30 seconds, rejects commands as unavailable, and then shows the Sony observation

#### Scenario: Nothing playing
- **WHEN** no source reports playing or paused
- **THEN** the snapshot shows the freshest source's observation, ties going to configured order

### Requirement: Sonos Move source
The Sonos source SHALL read `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions` from the configured AVTransport control URL immediately and about every two seconds, in sequence, each with a 1.5-second timeout and a 64 KiB limit, and SHALL treat any failed call as a failed read that reports nothing. It SHALL treat an `x-sonos-vli` track URI as the AirPlay session and any other URI as `inactive` with no metadata or controls. It SHALL map `PLAYING`, `PAUSED_PLAYBACK` and `STOPPED` to `playing`, `paused` and `stopped` and any other state to `unknown`. It SHALL read the title, artist and optional album from the DIDL-Lite track metadata, trimmed and limited to 256 characters, and SHALL NOT copy artwork URIs, position or duration. It SHALL declare pause, next and previous while playing and play, next and previous while paused, each only when the device's current actions list it, and no controls otherwise. Commands SHALL send `Pause`, `Play` at speed 1, `Next` or `Previous` once; HTTP 200 is `sent`, a SOAP fault is `failed`, and anything else is uncertain.

#### Scenario: AirPlay track playing
- **WHEN** the Move reports `PLAYING`, an `x-sonos-vli` URI, metadata with title, artist and album, and actions including Pause, Next and Previous
- **THEN** the observation shows those values, status `playing` and controls pause, next and previous

#### Scenario: Paused with play advertised
- **WHEN** the Move reports `PAUSED_PLAYBACK` with actions including Play, Next and Previous
- **THEN** the observation declares play, next and previous

#### Scenario: Action not advertised
- **WHEN** the Move reports `PAUSED_PLAYBACK` and its actions omit Play
- **THEN** the observation declares only the advertised paused controls

#### Scenario: Stopped, transitioning or another input
- **WHEN** the Move reports `STOPPED`, an unrecognized state, or a track URI without the `x-sonos-vli` scheme
- **THEN** the observation is `stopped` or `unknown` with no controls, or `inactive` with no metadata and no controls

#### Scenario: Failed read
- **WHEN** a call returns a non-200 status, a SOAP fault, a malformed body or times out
- **THEN** the read reports nothing and the source's record ages

#### Scenario: Command outcomes
- **WHEN** the hub sends play while paused
- **THEN** the source posts `Play` with speed 1, an HTTP 200 reply is `sent`, an HTTP 500 SOAP fault is `failed`, and an unanswered call is `uncertain`
