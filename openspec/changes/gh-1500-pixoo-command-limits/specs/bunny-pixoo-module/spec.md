## MODIFIED Requirements

### Requirement: Private art staging

Pixoo SHALL accept supported `art-stage` minors only from the core and SHALL preserve the validated original and immutable 64×64 rendition in private transient storage. A stage SHALL have no display effect and SHALL NOT enter the permanent library. PNG stills and GIFs SHALL match their declared format, dimensions, frame count, duration and hash. Physical animations SHALL use one representable delay and the configured route’s command constraints. Decoding, bytes, queued work and live retained copies SHALL be bounded. A successful outcome SHALL mean the private copy committed, with observed evidence, and SHALL NOT claim physical output.

#### Scenario: A still and short animation are staged
- **WHEN** the core stages a valid PNG and a valid GIF
- **THEN** their originals are preserved, their immutable previews match the decoded 64×64 frames and effective timing, and no display command occurs
- **AND** the permanent catalog is unchanged

#### Scenario: Invalid or unauthorized staging
- **WHEN** a stage has a forged sender, bad signature or hash, false decoded metadata, excessive resources or unsupported timing
- **THEN** it is refused or completes failed without offering the copy and without a display command

#### Scenario: Duplicate and conflicting composition identities
- **WHEN** an unexpired composition is staged again with identical bytes
- **THEN** its immutable rendition is reused and its lifetime is renewed
- **WHEN** the same unexpired composition is staged with different bytes
- **THEN** it is refused with duplicate-conflict and the original copy is unchanged

#### Scenario: Retention and restart preserve ownership
- **WHEN** a staged copy expires or staging fails and cleanup runs
- **THEN** unused transient copies are removed without removing any permanent library original or referenced rendition
- **AND** a copy held by an active moment or preview remains until that use ends
- **WHEN** the module restarts
- **THEN** committed unexpired copies remain usable, unfinished commands report uncertainty and no presentation replays

## ADDED Requirements

### Requirement: Pixoo animation admission follows the selected command

The Pixoo SHALL preserve originals, immutable renditions and ordered frames with their delays for local preview. It SHALL bound input bytes, source and scaled decoded pixels, storage, worker time and queue capacity. Physical playback SHALL use the configured command route with uniform timing. Direct raw uploads SHALL admit at most 59 frames and refuse a larger count before a device write with a route-specific explanation. Whole-GIF playback SHALL admit 64×64 GIF renditions within the existing lossless encoding and resource budgets without imposing a frame-count ceiling. Existing named configurations SHALL retain their selected route, and existing renditions and playlist references SHALL remain readable under their original identities.

#### Scenario: Direct commands at the documented boundary

- **WHEN** a direct configuration receives uniform animations of 21, 59 and 60 frames
- **THEN** the first two reach its writer with every frame and offset, and the third is refused before a write with the direct route limit
- **AND** no hosted listener is required or selected

#### Scenario: Long library and hosted animation

- **WHEN** an admitted animation contains more than a thousand frames
- **THEN** the catalog and preview include the final frame and its source timing, and a uniformly timed losslessly representable version reaches the explicitly configured hosted writer
- **AND** physical admission leaves the original and mixed-delay preview available

#### Scenario: Resource refusal and compatibility

- **WHEN** a small source canvas would expand past the decoded-pixel budget or an immutable manifest exceeds storage bounds
- **THEN** rendering reports the exhausted resource and preserves previously committed media
- **WHEN** an existing installation reopens old rendition and playlist references
- **THEN** their original identities and selected route remain readable
