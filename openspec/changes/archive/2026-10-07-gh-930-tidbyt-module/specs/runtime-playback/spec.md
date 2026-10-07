## ADDED Requirements

### Requirement: Commands before the first reads after a start

A `playback-control` command that reaches its admission before every configured speaker's first read since the module's start has settled SHALL wait for those reads, at most 1.5 seconds, so it goes to the speaker the record will present. If they have still not all settled, the module SHALL refuse the command with `unavailable`, sending nothing. A command whose deadline passed during that wait SHALL NOT be sent: the module SHALL record it and publish `failed` with evidence `none` and `expired`, as for a command that waited for the read ahead. A command right after a start has no read ahead to wait for, so its reply SHALL still come within about 3 seconds.

#### Scenario: A command right after a start
- **WHEN** a pause arrives after a start while the HT-A9 has answered and the Move's first read is still in progress
- **THEN** it waits for the Move's read and goes to the Move once the Move answers playing; if the Move's read has not settled 1.5 seconds after the pause arrived, the pause is refused `unavailable` and reaches no speaker

#### Scenario: A command that expires while the first reads run
- **WHEN** a pause with a 1-second deadline arrives right after a start, while the Move takes 3 seconds over its first read
- **THEN** the SDK answers it `uncertain-result` at its deadline, no speaker hears it, and its outcome is `failed` with evidence `none` and `expired`

## MODIFIED Requirements

### Requirement: The playback record

The module SHALL serve the core family `playback` through sync and publish the presented source as `playback/2.0` state, type `org.bunny.playback.updated`, on `bunny.state.playback.<id>`, with the record's `id` as subject. The record SHALL carry `id`, `revision`, `availability`, `observedAtMs` once the presented speaker was ever read, and `playback`: `{"status": "unknown"}` while unavailable, otherwise the presented observation's `player`, trimmed title, artist and album of at most 256 characters, absent rather than empty, and `controls`. It SHALL publish a new revision only when the availability or the presented playback changes, including when the presented speaker's last observation crosses 5 and 30 seconds, and SHALL NOT publish for a read that changes nothing else. Each start SHALL publish a new `unavailable` revision before any read answers, and SHALL keep it until every configured speaker's first read since that start has settled, by answering or by failing, as a speaker that does not answer does at its call's 1.5-second deadline; only then SHALL it publish what those reads present, so no revision SHALL come from some speakers' first reads while another's is still in progress. Revisions SHALL rise across restarts. The record SHALL NOT name the presented speaker, its kind or its address.

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

### Requirement: Simulated speakers

The module SHALL provide `SimulatedSpeakers`, a transport that answers both protocols as the qualified speakers do, so the module's own parsing runs on it, keeps its state when the runtime restarts, and never contacts an address. A test or run SHALL be able to play a track to either speaker, pause, stop or switch it to another input, make it stop answering, answer each call late or answer again at once, and make its next command be refused or never answered. A late answer SHALL wait on the scheduler the test or run gives, real time by default. The runtime's `--simulate` SHALL build the module with it.

#### Scenario: A disposable run
- **WHEN** a run seeded for the speaker-playback scenario plays to the HT-A9, switches to the Move and silences it
- **THEN** the playback record follows, the run reaches no speaker, and its boundary checks pass
