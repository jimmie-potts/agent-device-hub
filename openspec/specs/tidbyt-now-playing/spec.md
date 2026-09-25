# tidbyt-now-playing Specification

## Purpose
Define the Tidbyt now-playing tile from [Hub #38](https://github.com/jimmie-potts/agent-device-hub/issues/38): a pure view of the hub's shared playback snapshot with visible staleness, drawn as a readable 64×32 card and published as its own background installation through the Tidbyt controller queue with bounded cadence and removal when nothing is playing.

## Requirements

### Requirement: Now-playing card from the shared playback snapshot
The Tidbyt now-playing view SHALL be a pure function of the last good playback snapshot, whether the latest read succeeded, and the snapshot's effective age. It SHALL show a card only while the playback status is `playing` or `paused` and the effective age is under 30 s. It MUST mark the card stale when the snapshot is `stale` or the latest read failed. It MUST show nothing for `unavailable`, `stopped`, `inactive` or `unknown`, and MUST NOT turn a missing or failed read into `paused`.

#### Scenario: Playing and paused
- **WHEN** an available snapshot reports `playing`, and later `paused`, with a title and artist
- **THEN** the card shows the title and artist with a play marker, then with a pause marker

#### Scenario: Stale snapshot
- **WHEN** the snapshot is `stale`, or a read fails less than 30 s after the last good observation
- **THEN** the last card is shown dimmed with a `?` marker

#### Scenario: Nothing to show
- **WHEN** the snapshot is `unavailable`, reports `stopped`, `inactive` or `unknown`, or reads keep failing until the effective age reaches 30 s
- **THEN** the view has nothing to show

### Requirement: Readable 64×32 card
The card SHALL be drawn as the renderer's 64×32 RGB frame with the 3×5 font. It SHALL give the title up to two 14-character lines when there is an artist, or all four when there is none, and give the artist the lines after the title. It SHALL wrap at spaces, split words longer than a line, and end truncated text with `.`. It SHALL uppercase text, fold accents to base letters and draw unsupported characters as `-`. It MUST NOT draw the album or any other snapshot field.

#### Scenario: Long title
- **WHEN** the title is longer than two lines
- **THEN** it wraps at word boundaries onto two lines and the second line ends with `.`

#### Scenario: Accents and punctuation
- **WHEN** the artist is `Beyoncé & JAY-Z`
- **THEN** the card draws `BEYONCE & JAY-Z`

### Requirement: Rate-bounded now-playing publishing through the controller queue
The now-playing publisher SHALL read the snapshot every 5 s and submit every write through the Tidbyt controller queue to its configured additional installation. It SHALL push only when the card differs from the last sent frame or 10 minutes after that push, with writes at least 15 s apart and intermediate changes coalesced to the latest. When there is nothing to show, it SHALL remove its installation unless the installation is known to be absent, reading the installation listing first when presence is unknown. A failed or uncertain write MUST NOT be replayed, and consecutive writes not confirmed sent MUST double the wait up to the refresh period. It MUST NOT write the status installation.

#### Scenario: Track change coalescing
- **WHEN** the track changes three times within 15 s of a push
- **THEN** exactly one further push happens after the 15 s gate, showing the latest track

#### Scenario: Removal when playback stops
- **WHEN** the card was pushed and the snapshot then reports `stopped`
- **THEN** one removal of the now-playing installation is submitted and the status installation is untouched

#### Scenario: Shared queue with status
- **WHEN** both the status and now-playing publishers write to one controller
- **THEN** each write names its own installation, the controller serializes them, and each publisher keeps its own 15 s gate
