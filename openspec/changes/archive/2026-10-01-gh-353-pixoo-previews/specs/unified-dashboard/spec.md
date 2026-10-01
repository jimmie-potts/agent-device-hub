## ADDED Requirements

### Requirement: Reusable Pixoo media previews

The dashboard SHALL register media-grid and playlist widgets at medium/large sizes and a now-showing widget at small/medium sizes. The component page SHALL compose all three and the home SHALL show now showing. Exact 64x64 rendition PNG frames SHALL animate in manifest order and delays with nearest-neighbor scaling, bounded sequential loading and cancellation on inactivity or selection change. Reduced motion SHALL prevent autoplay. Loading failure MUST NOT be presented as a complete animation. Device compatibility SHALL be shown independently from preview availability. Names SHALL preserve the producer's existing 120-character semantics; unnamed playlists use IDs.

#### Scenario: Complete variable-delay animation
- **WHEN** the owner selects an admitted 20-frame rendition with duplicate and full-color frames
- **THEN** all frames preserve their pixels, order and effective delays without inheriting the historical two-frame restriction

#### Scenario: Read-only playlists and current evidence
- **WHEN** the owner selects a playlist or views now showing
- **THEN** ordered items show their playback policy and current-media evidence remains distinguished from optical observation without sending any device command

#### Scenario: Revision and legacy handling
- **WHEN** a polled integration catalogRevision changes or the connection resynchronizes
- **THEN** affected catalog reads refresh once through the per-device scheduler, cross-read mismatches are rejected, and valid immutable frames remain bound to their rendition
- **AND** a 1.0 producer shows the unavailable reason while retaining existing controls

## MODIFIED Requirements

### Requirement: Component integration views
Each user-facing component SHALL use common identity, navigation, status, settings and capability/permission-driven controls with optional specialized views. Device status MUST distinguish selected mode, desired/pending state, last successful transmission, failures, freshness and external control. Missing evidence MUST remain unknown. Advanced-editor links MUST be validated. Exact Pixoo previews SHALL be available through the negotiated read-only catalog extension; other components require their own declared preview capability. General controls appear in the same component view only for the capabilities the controller declares.

#### Scenario: Heterogeneous components
- **WHEN** Nanoleaf, Pixoo and a third synthetic component declare different capabilities
- **THEN** each appears in common navigation with only supported authorized actions and explanations for unavailable operations

