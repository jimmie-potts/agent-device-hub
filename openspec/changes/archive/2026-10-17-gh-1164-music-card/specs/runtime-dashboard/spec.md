## ADDED Requirements

### Requirement: One glass Music card across Home Audio and Rooms

Home, the Audio workspace and explicitly selected rooms SHALL reuse the same music presentation and existing playback owner. The card SHALL keep the cover area, title, artist and album visible, omit control tabs, and place audio output beneath previous, play/pause and next controls. Unreported output SHALL remain Not reported. Current capabilities, authority, sync, freshness and tracked-operation evidence SHALL govern every explicit command. Missing artwork SHALL use a neutral fallback without changing command authority. Existing Music deep links and artwork association fences SHALL remain supported.

#### Scenario: A shared presentation
- **WHEN** a current playback record is shown on Home, Audio and one assigned room
- **THEN** each surface uses the same card, current artwork/metadata and supported controls, with no command on mounting or navigation

#### Scenario: Observation becomes stale or unavailable
- **WHEN** playback updates become stale, the copy loses sync or the owner reports unavailable
- **THEN** an exclamation mark and Stale or Unavailable replace Now playing, controls remain disabled until eligible current evidence returns, unavailable metadata is cleared, and no command is retried

#### Scenario: Read-only or unsupported resume
- **WHEN** the session lacks control authority or the current source does not offer play while paused
- **THEN** the card remains inspectable, the unsupported controls cannot dispatch, and the paused source directs the operator to resume from the iPhone

### Requirement: Persistent explicit Music card room placement

The operator SHALL explicitly place logical playback cards in zero or more existing rooms using authenticated revision-guarded metadata saves. Placements SHALL survive browser reload, another browser and runtime restart. The lighting layout SHALL remain the authority for room identities and names. Missing or deleted rooms SHALL not render a music placement. The interface SHALL identify placement as shared-card placement, not speaker selection, speaker location or room-specific audio routing. Stale room/layout copies, read-only authority or an unresolved save SHALL disable editing. Conflicting and uncertain saves SHALL require explicit refresh without replay. Home's existing music placement SHALL remain available independently of room placement.

#### Scenario: Save and recover room placement
- **WHEN** the operator selects an existing room, saves the placement and reloads or restarts the runtime
- **THEN** the same logical music card appears in that room from synced private metadata, and placement sends no playback command

#### Scenario: Room removal or interrupted save
- **WHEN** the room is removed, or a save reply becomes uncertain
- **THEN** a missing room renders no card, and uncertain editing waits for explicit reconciliation without changing playback or retrying the save

## MODIFIED Requirements

### Requirement: Optional artwork on the existing playback card

The runtime dashboard SHALL use its existing shared Home, Audio and assigned Rooms playback card, also retained on Music deep links, to show optional artwork from the current declared playback owner through authenticated same-origin module content. Only live, synced, available, known playing or paused ready observations from an unambiguous running owner SHALL load an image. The image SHALL be bounded and contained in a stable square above readable title, artist, album and supported controls. Loading, missing, malformed or failed artwork SHALL retain text and existing control authority and operation evidence. The image SHALL be decorative to assistive technology and SHALL add no keyboard stop. Existing role tokens, narrow layout, keyboard focus and accessibility SHALL be preserved. The browser SHALL use no receiver URL, inline image bytes, executable image content or additional acquisition path, and SHALL preserve the current image content security policy.

#### Scenario: Home and Music share current artwork
- **WHEN** an authorized browser visits Home and Music for the current ready observation
- **THEN** both cards show the current bounded image with readable metadata and supported controls, and page entry, navigation and multiple consumers cause no receiver acquisition or command

#### Scenario: Loading and failure preserve the card
- **WHEN** artwork is loading, absent in a 2.0 record, missing, unsupported, invalid or refused
- **THEN** the image area remains stable and text, keyboard focus, supported controls and operation evidence remain usable on desktop and narrow screens
