## ADDED Requirements

### Requirement: Compatible bounded playback artwork state

The shared contract SHALL register `playback/2.1` beside unchanged `playback/2.0`. The new version SHALL permit an optional top-level artwork member only for available or stale, known playing/paused playback. Artwork SHALL be a closed union of missing, unsupported or ready, each with an opaque UUID generation. Ready artwork SHALL declare `image/png`, integer dimensions from 1 through 128 and canonical padded base64 containing at most 65,536 bytes. Validation SHALL reject noncanonical encoding, mismatched PNG header dimensions and malformed version/shape. The complete state SHALL remain within the profile's 256 KiB envelope. Consumers SHALL accept both versions through existing sync/live paths without contacting the receiver or sharing module storage.

#### Scenario: Existing records remain valid
- **WHEN** an existing playback/2.0 record is validated or copied through sync
- **THEN** it remains valid and text-only consumers retain their behavior

#### Scenario: Artwork cannot enter the closed old schema
- **WHEN** artwork is added under playback/2.0, exceeds byte or dimension limits, declares a different media type or uses an unknown version
- **THEN** validation refuses the state

#### Scenario: Several consumers reuse one state
- **WHEN** SDK consumers sync and follow a ready playback/2.1 record
- **THEN** they receive the same bounded image and opaque generation without a receiver read or artwork service
