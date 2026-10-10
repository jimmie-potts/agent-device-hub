## MODIFIED Requirements

### Requirement: Pixoo state and copies

The module SHALL keep only state it owns, in its own SQLite file and private folder: the library's catalog and the player's checkpoint (through `Library.attach`), its revision counter, presentation and Now Playing settings, configuration revision and last outcome, the commands it accepted and has not completed, the commands it completed in the last 24 hours with a digest of each one's content, and each multi-frame rendition's hosted check by rendition and profile. It SHALL rebuild its copies of the core's `session/2.0` records and of the `playback/2.0` or `playback/2.1` record by sync and SHALL NOT store them. A copy that has not synced, or whose owner stopped serving, SHALL be tried again after a doubling wait. A copy that followed its owner and lost it SHALL log one warning. An owner that has not answered since the start SHALL log at DEBUG until the wait reaches its longest, then one warning, and its later arrival SHALL log one recovery.

#### Scenario: The library in the module's database
- **WHEN** the module starts on an empty state directory and imports media
- **THEN** the catalog's tables are in the module's SQLite file beside the outbox, the media files are in its private folder, and a restart finds them

#### Scenario: A playback owner that starts later
- **WHEN** no playback owner serves the record at the module's start, and one starts after the wait has grown to its longest
- **THEN** the early attempts log at DEBUG, one warning follows, one recovery is logged when the owner arrives, and the card follows its record

### Requirement: Monitor and Now Playing from synced records

Monitor SHALL draw the module's copy of the core's sessions, as divoom-app-upgrade's presentation drew its 1.x snapshot. It SHALL show one top-level session per page, attention first, its label or title or session ID, and its finished turns that the Pixoo has not acknowledged. It SHALL show the source as current, stale or unavailable from the copy's state. Now Playing SHALL draw the chosen playback record's track, from the configured record or else the first by ID. The card SHALL follow the record's `availability` and the copy's state, never the age of `observedAtMs`, since the owner publishes only changes: it SHALL be stale while the owner marks the record `stale` or the copy stops following its owner, and gone for an `unavailable` record or a player that is neither playing nor paused. A song that plays on unchanged SHALL keep a current card, and a whole takeover SHALL hold it for as long as the song plays. Dashboards and cards SHALL render in worker calls; a failed render SHALL keep the last picture, SHALL be tried again, SHALL be logged once per run of failures, and SHALL be no evidence about the device. The dashboard SHALL render only while Monitor participates, its layout staying current otherwise, and a changed card SHALL keep the pixels already on the device until a replacement is eligible and ready, without newly transmitting a previous observation.

Eligible ready artwork SHALL be decoded within the existing card worker under its declared PNG byte and dimension bounds and shown beside readable text in a static region. Stale cards SHALL dim image and text. Missing, unsupported, corrupt, animated or dimension-mismatched artwork SHALL produce the exact text fallback. Artwork and association tokens SHALL stay in private render context, outside the browser-facing playback view. Pending renders and queued card writes SHALL be rejected when their observation or presentation eligibility is superseded, including attention, stop, mode change, pop-up expiry and close. An internally superseded cancellation with no prior effects SHALL NOT suspend Monitor, end a current takeover, alter player or user-command outcomes, or report a device failure. Current failures and possible partial effects SHALL retain their existing uncertainty and recovery rules. Artwork arrival, disappearance or generation change alone SHALL neither trigger another track pop-up nor extend its deadline, pause the playlist again or reopen an expired pop-up. The module SHALL fetch no artwork and store no image bytes or playback history.

#### Scenario: Monitor follows the core's sessions
- **WHEN** Monitor is selected, and the core publishes a session that waits for approval, then one whose approval resolved
- **THEN** the Pixoo shows that session's dashboard, two frames pulsing, as rendered from the synced record, then one calm frame; the display record shows Monitor participating with one matching session needing attention; and the paints are the device's last transmission with no request ID

#### Scenario: Now Playing pops up over Monitor
- **WHEN** Monitor shows a session and the playback record starts a track
- **THEN** the Pixoo shows the track's card for ten seconds, the display record shows the card with no takeover, and Monitor's dashboard returns

#### Scenario: A song that plays on unchanged
- **WHEN** the playback module's record keeps playing one song for more than 30 s without a change, first over Monitor and then while a whole takeover holds Media
- **THEN** the card stays bright through the ten-second pop-up, the display record shows it current, the whole takeover keeps it on the Pixoo for more than 30 s, and the playlist comes back once the song stops; the card turns stale only when the record does

#### Scenario: A failed render
- **WHEN** every render fails
- **THEN** nothing reaches the device, the device stays available, one warning reports the run of failures, and the module keeps running

#### Scenario: Artwork and exact fallback (Hub #285 AC1)
- **WHEN** eligible playing, paused and stale records carry a bounded ready PNG, long or missing text, or missing, unsupported or invalid artwork
- **THEN** independently checked 64x64 frames contain readable status and text beside the correctly sized image, stale image and text are dimmed, and every absent or refused image uses the existing text frame

#### Scenario: Same-text handoff while work waits (Hub #285 AC2)
- **WHEN** a Sony observation's card render or device write waits and a same-title Sonos observation or another Sony generation replaces it
- **THEN** no superseded image is newly transmitted beside current metadata, Sonos uses the text fallback, the current render alone can populate the cache, and no-effect internal cancellation preserves player and presentation state

#### Scenario: Artwork within the original pop-up (Hub #285 AC3)
- **WHEN** artwork arrives during a Monitor or Media pop-up, changes again after its original deadline, or finishes after attention supersedes it
- **THEN** it updates only an eligible current card, the original deadline and attention policy hold, and it neither extends nor reopens the pop-up; Media off and whole retain their existing policies
