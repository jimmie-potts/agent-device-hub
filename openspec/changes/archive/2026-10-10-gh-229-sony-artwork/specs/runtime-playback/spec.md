## ADDED Requirements

### Requirement: Optional shared Sony artwork

The playback owner SHALL acquire optional Sony artwork independently of metadata and controls. It SHALL fetch only an absolute HTTP URL on the configured receiver's origin, without credentials or a fragment, and SHALL refuse redirects. Acquisition SHALL ignore HTTP media-type claims, admit JPEG or PNG bytes, and normalize a single image to a metadata-free PNG no larger than 128×128 and 65,536 bytes. Input SHALL be limited to 1,048,576 bytes and 4,000,000 decoded pixels. Fetch and worker decode SHALL each have a 2,000 ms deadline. At most one acquisition chain SHALL be admitted at a time, with only the newest replacement retained. Failures SHALL retain text-only playback and current control routing, with safe diagnostics that expose no URL, image bytes or listening metadata.

#### Scenario: Qualified JPEG with an incorrect media type
- **WHEN** the presented Sony source reports a same-origin JPEG thumbnail served as `text/plain`
- **THEN** metadata is published without waiting for the image and a bounded normalized PNG is subsequently shared

#### Scenario: Invalid or absent image
- **WHEN** content is absent, bytes cannot be decoded, the origin is different, a redirect occurs, a deadline expires or any capacity limit is exceeded
- **THEN** the image remains missing and playback text, availability and controls remain governed by metadata

### Requirement: Artwork follows the presented observation

Artwork SHALL carry an opaque generation that changes on a presented source or reported track change, loss of the eligible playing/paused session, unavailable playback or restart. A generation SHALL persist through duplicate polls, playing/paused transitions and freshness-only changes. Candidate replacement SHALL invalidate earlier pending results even within the same generation. The owner SHALL retain only current artwork, deduplicate acquired candidates and permit at most three transient attempts per candidate and generation, spaced by bounded backoff. A later candidate after absent content SHALL be eligible for acquisition. Image completion SHALL NOT refresh metadata evidence or trigger a new-track presentation. Sonos SHALL publish unsupported artwork and SHALL NOT inherit Sony artwork. Metadata that the receiver has not yet reported SHALL NOT be inferred.

#### Scenario: Late artwork after a handoff
- **WHEN** Sony artwork is pending and Sonos becomes presented with identical text
- **THEN** the generation changes, Sonos is unsupported and the late Sony result cannot restore an image

#### Scenario: Same observation receives artwork later
- **WHEN** duplicate metadata initially lacks a candidate and later reports one
- **THEN** the current generation can become ready without changing the track, freshness evidence or presentation timer

#### Scenario: Stop and restart
- **WHEN** the module stops while fetching or decoding and then restarts
- **THEN** pending work is aborted, cannot publish and cannot restore the previous image

## MODIFIED Requirements

### Requirement: The playback record

The module SHALL serve the core family `playback` through sync and publish the presented source as `playback/2.1` state, type `org.bunny.playback.updated`, on `bunny.state.playback.<id>`, with the record's `id` as subject. The record SHALL carry `id`, `revision`, `availability`, `observedAtMs` once the presented speaker was ever read, and `playback`: `{"status": "unknown"}` while unavailable, otherwise the presented observation's `player`, trimmed title, artist and album of at most 256 characters, absent rather than empty, and `controls`. It SHALL publish a new revision only when the availability, presented playback or optional artwork changes, including when the presented speaker's last observation crosses 5 and 30 seconds, and SHALL NOT publish for a read that changes nothing else. Each start SHALL publish a new `unavailable` revision before any read answers, and SHALL keep it until every configured speaker's first read since that start has settled, by answering or by failing. A read fails at the latest when one of its calls gets no answer within that call's 1.5-second deadline, so the hold lasts at most about 1.5 seconds for the HT-A9's one call and about 4.5 seconds for the Move's three. Only then SHALL it publish what those reads present, so no revision SHALL come from some speakers' first reads while another's is still in progress. Artwork completion SHALL NOT advance metadata observation evidence or the 5-second and 30-second freshness deadlines. Revisions SHALL rise across restarts. The record SHALL NOT name the presented speaker, its kind or its address.

#### Scenario: Startup
- **WHEN** the module starts and no speaker has answered yet
- **THEN** it publishes an `unavailable` record with unknown playback, then, once every speaker's first read has settled, the record those reads present

#### Scenario: A slower second speaker
- **WHEN** after a start the HT-A9, on another input, answers at once, and the Move, configured first and playing, answers its first read 1.2 seconds later
- **THEN** the record stays `unavailable` until the Move's read answers, and its next revision shows the Move's song playing, never the HT-A9's other input

#### Scenario: A speaker that never answers at start
- **WHEN** after a start the HT-A9 plays and answers at once, and the Move never answers
- **THEN** the record stays `unavailable` until the Move's first call reaches its 1.5-second deadline, then shows the HT-A9 playing, and the Move's outage is logged once

#### Scenario: A silent speaker
- **WHEN** the only speaker stops answering after a successful read
- **THEN** a `stale` revision keeping the last playback is published exactly 5 seconds after that read, an `unavailable` revision with unknown playback exactly 30 seconds after it, nothing in between, and the next successful read publishes an `available` revision

#### Scenario: Restart
- **WHEN** the module restarts on the same database
- **THEN** its revisions continue above the last one it published

### Requirement: Sony HT-A9 source

The Sony source SHALL read `getPlayingContentInfo` version 1.2 with `[{output: ""}]`, and SHALL normalize the AirPlay entry's title, artist, optional album and state: `PLAYING`, `PAUSED` and `STOPPED` to `playing`, `paused` and `stopped`, and any other state to `unknown`. It SHALL declare pause, next and previous while AirPlay plays, only next and previous while paused, no controls otherwise, and never play. A reply without an AirPlay entry SHALL be `inactive` with no metadata or controls. A JSON-RPC error, an HTTP error, a malformed body, a reply to another ID, a dropped connection or a missed deadline SHALL fail the read. Commands SHALL call `pausePlayingContent` 1.1, `setPlayNextContent` 1.0 or `setPlayPreviousContent` 1.0 once: a result is sent, a JSON-RPC error is a refusal, and no answer is uncertain. An optional thumbnail URL of at most 2,048 characters MAY be retained privately for independent artwork acquisition; it SHALL NOT enter a public playback record, log or error. No other receiver field SHALL be copied.

#### Scenario: Paused AirPlay
- **WHEN** the HT-A9 reports AirPlay `PAUSED` with no album
- **THEN** the observation is paused with next and previous, and no album

#### Scenario: Failed reads
- **WHEN** a read gets an error, an HTTP 500, a non-JSON body, a wrong result, a dropped connection, no answer or another ID
- **THEN** the observation time does not change
