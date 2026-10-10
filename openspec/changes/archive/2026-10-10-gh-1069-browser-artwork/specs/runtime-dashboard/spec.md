## ADDED Requirements

### Requirement: Optional artwork on the existing playback card

The runtime dashboard SHALL use its existing shared Home and Music playback card to show optional artwork from the current declared playback owner through authenticated same-origin module content. Only live, synced, available, known playing or paused ready observations from an unambiguous running owner SHALL load an image. The image SHALL be bounded and contained in a stable square beside readable title, artist and supported controls. Loading, missing, malformed or failed artwork SHALL retain text and existing control authority and operation evidence. The image SHALL be decorative to assistive technology and SHALL add no keyboard stop. Existing role tokens, narrow layout, keyboard focus and accessibility SHALL be preserved. The browser SHALL use no receiver URL, inline image bytes, executable image content or additional acquisition path, and SHALL preserve the current image content security policy.

#### Scenario: Home and Music share current artwork
- **WHEN** an authorized browser visits Home and Music for the current ready observation
- **THEN** both cards show the current bounded image with readable metadata and supported controls, and page entry, navigation and multiple consumers cause no receiver acquisition or command

#### Scenario: Loading and failure preserve the card
- **WHEN** artwork is loading, absent in a 2.0 record, missing, unsupported, invalid or refused
- **THEN** the image area remains stable and text, keyboard focus, supported controls and operation evidence remain usable on desktop and narrow screens

### Requirement: Browser artwork follows current observation membership

The browser SHALL associate each image and its load/error callbacks with the playback owner, record ID, artwork generation and record revision. New metadata or revision SHALL retire the previous image immediately and use a distinct content reference. An old response or callback SHALL NOT reveal earlier artwork beside current metadata. Source handoff, sync loss, stale or unavailable state and unmount SHALL remove the old image; reconnect SHALL load only current eligible membership without replaying a command. Image completion or failure SHALL NOT enable controls or report playback success, and SHALL NOT retry a command or start an image retry loop.

#### Scenario: Delayed A arrives after B
- **WHEN** image A is delayed while observation B becomes current, including identical-title source changes or a candidate replacement in the same generation
- **THEN** A's element is removed before its delayed completion, its callback cannot reveal A, and only B's current reference can become visible

#### Scenario: Lost sync and re-entry
- **WHEN** the playback sync fails, a route unmounts or the session ends while an image is pending, then the page reconnects or re-enters
- **THEN** the old image is absent, later callbacks cannot restore it, controls retain their current-state guards and no command is replayed

#### Scenario: Sonos and freshness fallback
- **WHEN** Sonos is presented with the same title as Sony, or the current record becomes stale, unavailable or inactive
- **THEN** Sony artwork disappears immediately and the card preserves its existing text and uncertainty presentation
