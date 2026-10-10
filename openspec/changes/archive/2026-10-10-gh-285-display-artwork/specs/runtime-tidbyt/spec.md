## MODIFIED Requirements

### Requirement: Now-playing tile from the playback record

With `nowPlaying` configured, the module SHALL keep a synced copy of the playback module's `playback` records and draw the configured record with the runner's text fallback: a green play triangle or amber pause bars, the title and the artist, for a `playing` or `paused` record that is `available` or `stale`. A `stale` record SHALL dim the card with a `?` marker. An `unavailable` record, unknown playback, a stopped track or another input SHALL remove the card. Freshness SHALL come from the record's `availability`, never from the age of `observedAtMs`. While the copy does not follow the playback module, the last card SHALL be dimmed, and it SHALL be removed once the copy has not followed for 30 s. Within 30 s of the module's start, the tile SHALL write nothing while its copy has not synced, or while the configured record is missing or `unavailable`, which the playback module publishes at each start until every speaker's first read has settled; a record still `unavailable` after that window SHALL remove the card. The window SHALL hold nothing else: a record that says the music stopped or another input plays SHALL remove the card within the window too.

The card SHALL accept `playback/2.0` and `playback/2.1`. Eligible ready artwork SHALL be decoded in the existing worker under the declared PNG byte and dimension bounds and shown beside readable text in a static region; stale cards SHALL dim both image and text. Missing, unsupported, corrupt, animated or dimension-mismatched artwork SHALL produce the exact text fallback. A failed or cancelled worker SHALL send nothing and retain the existing failure and recovery policy. The module SHALL fetch no artwork and store no image bytes or history. Pending renders and queued pushes or removals SHALL be admitted only while their selected observation and current eligible target remain current. A discard before any cloud call SHALL neither persist an uncertain write nor consume the transmission gate or report a device failure. A cloud call that began SHALL retain its real outcome and end-based gate even if its target changes.

#### Scenario: Play, pause, stale and the end of playback
- **WHEN** the record plays, pauses, turns stale, then turns unavailable
- **THEN** the tile shows the playing card, the paused card and the dimmed card, each after its gate, then leaves the rotation once, and missing playback never shows as paused

#### Scenario: A playback module that starts late
- **WHEN** a leftover card is in the rotation and the playback module starts serving 5 s after the Tidbyt module
- **THEN** the tile removes nothing and shows the card once its copy syncs; with no playback module at all, the leftover card is removed after 30 s

#### Scenario: The playback module's start-time record
- **WHEN** the runtime restarts while a song plays, the playback module first serves its record `unavailable` with unknown playback, then the same song playing, 5 s later or 1.2 s later as when the Move answers after the HT-A9
- **THEN** the card is neither removed nor pushed again; from a fresh start with a leftover card and a record that stays `unavailable`, nothing is written for 30 s, then the card is removed

#### Scenario: Another input inside the start window
- **WHEN** the runtime restarts while a song's card has stood past its gate, and the playback record turns from `unavailable` to another input, then back to the song
- **THEN** the card is removed, and pushed again once the song plays and its gate opens

#### Scenario: A lost playback copy
- **WHEN** the playback copy stops following its owner while a song plays
- **THEN** the card is dimmed, and removed 30 s after the loss

#### Scenario: Artwork and exact fallback (Hub #285 AC1)
- **WHEN** eligible playing, paused and stale records carry a bounded ready PNG, long or missing text, or missing, unsupported or invalid artwork
- **THEN** independently decoded 64x32 frames contain readable status and text beside the correctly sized image, stale image and text are dimmed, and every absent or refused image uses the existing text frame

#### Scenario: Superseded render and queued write (Hub #285 AC2–AC3)
- **WHEN** A renders or waits behind a cloud call or rate-limit hold, then B or a same-text source handoff replaces it, or an obsolete removal waits while a new card becomes eligible
- **THEN** no obsolete push or removal reaches the cloud, no discarded write is persisted or logged as a failure, and the latest target is evaluated using the existing rotation, hold, gate and refresh rules
