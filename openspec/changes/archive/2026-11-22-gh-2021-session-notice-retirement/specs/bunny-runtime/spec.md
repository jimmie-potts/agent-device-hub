## MODIFIED Requirements

### Requirement: Session capacity

The core SHALL hold at most 128 sessions, roots and children from any source together. At the limit it SHALL refuse a new child. A new root SHALL displace one child subtree whose every member is finished and holds no attention, the subtree whose newest evidence is oldest first, ties to the lower identity key, through the ordinary retirement path; without one, the new root SHALL be refused. Roots SHALL never be displaced. A refusal SHALL change nothing, SHALL be recorded as `message.received` refused with `capacity`, and SHALL be silent to the reporting producer.

A session SHALL hold at most 128 notices and 256 ordering watermarks (Hub #2021), so a session can keep taking turns. When an observation would leave a session with more than 128 notices, the session logic SHALL retire superseded notices until the session holds 128: first those that every configured consumer has acknowledged, then the oldest. A notice is superseded when it no longer counts under `noticeCounts`, that is, when its turn and the session's turn are both known and differ. A notice that still counts SHALL never be retired, and the observation SHALL be refused with `capacity` when the notices that still count alone exceed 128. Below the limit, no notice SHALL be retired. Only the observation transition SHALL retire notices; acknowledgments, the notice override, read receipts, titles, labels, expiry and the core's start SHALL retire none. A retired notice's turn end SHALL stay in history.

When an ordered observation would leave a session with more than 256 watermarks, the session logic SHALL drop the watermarks of attention dimensions whose item the session no longer holds, lowest sequence first, until it holds 256. For each epoch it drops a watermark in, it SHALL keep one floor, the highest sequence it dropped in that epoch, stored as a watermark under the reserved dimension `floor`, which no observation's dimension uses. An ordered observation whose sequence is at or below its epoch's floor, in a dimension without its own watermark, SHALL be `stale`. The watermarks of activity, read and unavailability dimensions, and of attention the session holds, SHALL never be dropped.

The bounds SHALL need no migration and no change at the core's start: a session that a release before them stored at 128 notices SHALL take its next turn end, retiring its oldest superseded notice. A floor SHALL be inert to a release before it.

#### Scenario: Roots from two sources at the limit
- **WHEN** the core holds 128 sessions from two sources, among them one finished child subtree, and two new roots and a new child arrive
- **THEN** the first root displaces the finished subtree, the second root and the child are refused with `capacity`, and no root is removed

#### Scenario: A session that ends more turns than the notice limit
- **WHEN** a Claude-shaped session and a native conversation each end 136 turns, each on its own known turn
- **THEN** every observation applies, each session holds the notices of its newest 128 turns, and the notice of the current turn stays unacknowledged and counts for every reader

#### Scenario: A fully acknowledged superseded notice retires first
- **WHEN** a session holds 128 notices, the dashboard acknowledges an earlier turn's notice that Nanoleaf and Pixoo acknowledged at the next turn, and the session then ends two more turns
- **THEN** the acknowledgment and the next turn start retire nothing, the first turn end retires that fully acknowledged notice, and the second retires the oldest

#### Scenario: Only counting notices past the limit
- **WHEN** a root whose provider names no turn ends 129 turns, so every notice still counts
- **THEN** the first 128 apply and the 129th is refused with `capacity`, and no notice is retired

#### Scenario: A session stored at the limit by an earlier release
- **WHEN** a session holds 128 notices and works on a turn whose end an earlier release refused, and the core restarts
- **THEN** the start changes no notice, and the turn's end applies, shows the session finished and retires the oldest superseded notice

#### Scenario: A native conversation that asks more questions than the watermark limit
- **WHEN** one native task asks and answers 268 questions, with one more question still open after the first 264
- **THEN** every observation applies, the session holds at most 256 watermarks, the activity watermark and the open question's are kept, and the epoch has one floor

#### Scenario: Evidence at or below the floor
- **WHEN** after the floor is set, new questions arrive at the floor's sequence, below it and above it
- **THEN** the two at or below the floor are `stale` and raise nothing, and the one above applies as a new dimension always did

#### Scenario: A late duplicate after its retry key and watermark are gone
- **WHEN** a question that was asked and answered is redelivered after the session's retry keys have rotated and its watermark was dropped
- **THEN** it is `stale` and raises no attention
