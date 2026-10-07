## MODIFIED Requirements

### Requirement: One writer, the 15-second gate and no replay

Every cloud call SHALL go through one queue, one call at a time, in order, behind a lease on the cloud device in the module's private folder. Each tile SHALL push only when its frame changes, at most once every 15 s measured from the end of the tile's previous call: its answer, a failure such as a refused connection, or its 10-second deadline when nothing came back. A request reaches the cloud before its call ends, however long it takes on the way, so the cloud SHALL receive a tile's writes at least 15 s apart. Each tile SHALL coalesce changes into one push of the latest state, and SHALL push an unchanged frame again 10 minutes after that frame's push ended. A tile with nothing to show SHALL be removed; when its presence is unknown, the tile SHALL read the installation list first and delete only an installation that is there. A write that failed or may have taken effect SHALL NOT be sent again: a later write SHALL be a fresh one for the current state, after a wait that starts at 15 s and doubles up to 10 minutes, and an uncertain push SHALL make the installation's presence unknown. A 401, a 403 or the cloud's "no UID" 500 SHALL hold every later call without a request until the runtime restarts, and a 429 SHALL hold later calls for its `Retry-After`. A module that cannot take the lease SHALL write nothing and report the Tidbyt `unavailable`.

#### Scenario: A burst inside the gate
- **WHEN** three session changes arrive within 15 s of a push
- **THEN** nothing more is pushed inside the gate, and one push 15 s after the first shows the latest state; nothing follows without a change

#### Scenario: A push that reaches the cloud late
- **WHEN** the first push takes 300 ms to reach the cloud, and a session changes within the gate
- **THEN** the next push reaches the cloud 15 s after the first arrived, not 15 s after it went out

#### Scenario: A push that never answers
- **WHEN** a push takes 9 s to reach the cloud and its answer is lost, so its call ends uncertain at its 10-second deadline, and a session changes
- **THEN** the next push goes out no sooner than 15 s after that deadline, and the cloud receives the two at least 15 s apart

#### Scenario: The refresh
- **WHEN** a frame stays unchanged
- **THEN** it is pushed again only after 10 minutes

#### Scenario: Idle removal
- **WHEN** an idle start finds leftover tiles in the listing, or the last session's finished turn is acknowledged
- **THEN** each tile is deleted once, after a listing when its presence was unknown and without one when it was present, and an absent tile is never deleted

#### Scenario: Failed and uncertain writes
- **WHEN** the cloud refuses a push, keeps refusing removals, or answers a push with a server error
- **THEN** the refused push is followed by a fresh one 15 s later; the removals come at 15, 45, 105, 225 and 465 s and then every 10 minutes, with one record for the run; and after the uncertain push an idle tile reads the list before deleting

#### Scenario: Holds
- **WHEN** the cloud refuses the key, or answers 429 with `Retry-After: 30`
- **THEN** no further request goes out under the authentication hold and one record names it; under the rate limit the next push waits 30 s

#### Scenario: A second writer
- **WHEN** a second instance of the module starts on the same state directory while the first holds the lease
- **THEN** the second logs the refused lease, reaches no cloud and reports the Tidbyt `unavailable`
