## ADDED Requirements

### Requirement: Status rows from the shared state feed
The Tidbyt status view SHALL be a pure function of one shared agent-state snapshot. It MUST NOT reduce lifecycle events itself. It SHALL show root sessions as `ASK` when attention is present, otherwise `RUN` when activity is active or the owner counts an active child session, otherwise `DONE` when a turn-ended notice lacks an acknowledgment from the configured consumers. It MUST NOT show any other session as done. Rows MUST be ordered `ASK`, `RUN`, `DONE`, then by newer evidence, with at most four rows and a `+N MORE` row replacing the fourth when more sessions qualify.

#### Scenario: Multiple sessions
- **WHEN** the snapshot holds sessions needing attention, working, holding an unacknowledged notice, idle, and a child session
- **THEN** the view shows one `ASK`, one `RUN` and one `DONE` row in that order and omits the idle and child sessions

#### Scenario: Working child session
- **WHEN** a root session is idle but the owner counts one active child session
- **THEN** the root shows `RUN` and the installation is not removed

#### Scenario: More than four sessions
- **WHEN** six sessions qualify
- **THEN** three session rows are drawn and the fourth row reads `+3 MORE`

#### Scenario: Acknowledgment and read evidence
- **WHEN** a session's only notice is marked read but not acknowledged, and another session's notice has been acknowledged by a configured consumer
- **THEN** the first still shows `DONE` and the second is not shown

#### Scenario: Missing evidence is not done
- **WHEN** a session has unknown activity, no attention and no notice
- **THEN** it is not shown as `DONE`

### Requirement: Private labels
Each row SHALL be labelled with the session's user label, otherwise its user-chosen project ID, otherwise a neutral ID derived by hashing its identity. The view MUST NOT draw any other snapshot text.

#### Scenario: Neutral ID
- **WHEN** a session has no label and no project ID
- **THEN** its row shows `C` for Claude or `X` for Codex and four hex digits of the identity hash, and none of its identity fields appear in the frame text

### Requirement: Visible uncertainty
The view SHALL dim and mark with `?` every session whose freshness is uncertain. When the feed cannot be read or its collector is not running, it SHALL mark every row from the last good snapshot the same way, or show `FEED ?` when there is none. An unavailable feed MUST NOT remove the installation.

#### Scenario: Stale session
- **WHEN** a working session's freshness is uncertain
- **THEN** its row still reads `RUN` but is dimmed with a `?` marker

#### Scenario: Stale feed
- **WHEN** the feed throws after a good snapshot, or reports a faulted collector
- **THEN** the pushed frame shows the last rows dimmed and marked, and no removal is submitted

### Requirement: Rate-bounded publishing through the controller queue
The status publisher SHALL submit every write through the Tidbyt controller queue. It SHALL push only when the rendered frame differs from the last sent frame or 10 minutes have passed since that push. Writes MUST be at least 15 s apart, and requests in between MUST coalesce so only the latest state is written. When nothing qualifies and the feed is healthy, it SHALL remove the installation unless the installation is known to be absent, first reading the installation list when presence is unknown. A failed or uncertain write MUST NOT be replayed; a later write is a new request for the current state. The wait after consecutive unsent writes MUST double, up to the refresh period.

#### Scenario: Coalescing changes
- **WHEN** the feed changes three times within 15 s of a push
- **THEN** exactly one further push happens once 15 s have passed, showing the latest state

#### Scenario: Unchanged frame refresh
- **WHEN** the frame stays the same
- **THEN** no push happens until 10 minutes after the last push

#### Scenario: Idle removal
- **WHEN** every session becomes idle after a push
- **THEN** one removal is submitted, and no further removal happens while the feed stays idle

#### Scenario: Removal of an absent installation
- **WHEN** presence is unknown and the installation list shows the installation absent, including after a failed removal
- **THEN** no removal is sent and presence becomes absent

#### Scenario: Persistent write failure
- **WHEN** every removal fails
- **THEN** attempts come 15, 30, 60 s and so on apart, never more than 10 minutes apart

#### Scenario: Failed push
- **WHEN** a push fails
- **THEN** the same frame is submitted again as a new request no sooner than 15 s later, and the failed request is never resubmitted
