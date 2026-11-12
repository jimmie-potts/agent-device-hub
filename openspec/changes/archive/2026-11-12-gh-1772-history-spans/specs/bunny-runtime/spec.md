## MODIFIED Requirements

### Requirement: Core history

The core SHALL keep history in private rows of the core store, with no time limit, each written in the transaction that commits what it records: every removal, occurrence and outcome whole, the core's own and every other participant's; each state change, the core's own and every module's, as a compact change event, what changed since the record of that entity's last row (`previous`, its revision, or null for a new entity, whose every member changed), each changed top-level member with its new value and each removed member, never a whole snapshot, a state that is stale adding nothing; and each step of every tracked action, as its event, status, result, evidence, error and the outcome that caused it. A removal SHALL leave a tombstone at its revision, so a late state at or below it adds nothing. History SHALL keep no hook's raw lifecycle observation, whose changes it keeps, and no acknowledgment. Viewing history SHALL never trigger a device or automation; its read API with filters and the timeline are Hub #923's (owner decision, 2026-10-07).

History SHALL keep changes, and repeated readings as spans (#1772, owner decisions 1, 2 and 4 on #1768). A state whose record holds the same state as the record of its entity's last row, as the contracts package's `sameState` decides with the family's bookkeeping members (the requirement "Bookkeeping members of state families" of the message profile), SHALL write no row: it SHALL update the entity's open span, which keeps when the stretch started, its last confirmation, how many readings history took in it, and the last revision, message ID and type a reading carried, in a table outside the rows, in the same transaction. A state that differs SHALL write a change row whose `changed` holds every top-level member that differs from the last row's record, bookkeeping values included, so a record rebuilt from the rows equals the published record at each change row; the row SHALL carry the span it closes as `span` (`sinceAtMs`, `lastConfirmedAtMs`, `confirmations`) when history took more readings in the stretch than the row that opened it. For a family that a module's registration declares as published on a poll, a confirmation that comes more than four polling intervals, and more than two minutes, after the last one SHALL write one gap row: a change row with the moved values, the silence as `gapMs` and the span it closes. A family published only when something happens SHALL have no gap rule. A removal of an entity whose open span holds readings beyond its row SHALL first write a change row that changes no member, carries the last row's revision as both `revision` and `previous` and no message ID, closes the span with the last confirmation's time and count, and carries `closedBy: 'removal'`, so a record rebuilt at it equals the published record at that revision; then the removal whole. A state below the last confirmation's revision, and the last confirmation's message again with the same state, SHALL add nothing; a state that reuses that message ID with another state SHALL be a change. A confirmation stamped before the last one SHALL NOT move the last confirmation back. Rows SHALL never be updated or deleted, the fact log SHALL stay gapless, and a read after a sequence SHALL return rows only. The latest-record table SHALL keep its five columns, so the release before this change still opens and writes the store. Each span SHALL keep the revision of the entity's last row it was written against; a span whose kept revision differs from the latest-record table's, because such a release took a reading of its entity, SHALL be reset to an unknown start (`sinceAtMs` null), and a span of an entity that release took no reading of SHALL be kept. Rows already stored SHALL be left as they are.

#### Scenario: What changed
- **WHEN** a module publishes a record, a change of one member, the same record again, an older one, a record without a member, an occurrence twice with one ID, a removal and a later state at the removal's revision
- **THEN** history holds three change events, the first with `previous` null and every member, the second with the one member, the third with the member removed, then the occurrence once and whole, and the removal, and nothing else

#### Scenario: The core's own changes
- **WHEN** a hook observes a session start and an approval prompt
- **THEN** history holds the two session states as change events, the second holding only what changed, and `attention.raised` whole, in the commits that published them

#### Scenario: Repeated readings are a span
- **WHEN** a Wemo plug publishes ten readings every 5 s whose only change is the reading time
- **THEN** history holds one change row, and the plug's span starts at the first reading, was last confirmed at the tenth and counts ten readings

#### Scenario: A change closes the span
- **WHEN** the plug then reports its power off
- **THEN** history writes one change row with the desired and observed members, the moved reading time included, `previous` the first row's revision, and the span it closes, and a new span opens

#### Scenario: A gap
- **WHEN** the plug, polled every 5 s, falls silent for two minutes and then for two minutes and one millisecond, a vacuum polled every 60 s falls silent for four minutes and then for longer, and a Nanoleaf device record falls silent for an hour
- **THEN** only the plug's second silence and the vacuum's longer one each write one gap row with its silence and closed span, and the Nanoleaf record writes none

#### Scenario: A removal closes the span
- **WHEN** an entity with confirmations beyond its row is removed, and its last confirmation and a state at the removal's revision arrive later
- **THEN** history writes a change row with no changed member, the last row's revision, no message ID, the closed span and `closedBy: 'removal'`, then the removal whole; a record rebuilt at the closing row equals the record published at its revision, and the late states add nothing

#### Scenario: A confirmation at the last row's revision
- **WHEN** a publisher repeats the revision of its last row seven times, and another entity's confirmation at its row's revision is followed by a reading ten minutes later
- **THEN** the first span counts seven readings from its known start, and the second reading writes one gap row whose span keeps its known start

#### Scenario: Stale and resent states
- **WHEN** a state below the last row's revision, a state below the last confirmation's revision and the last confirmation again arrive
- **THEN** none writes a row and the span counts the confirmation once

#### Scenario: A reused message ID or a clock stepping back
- **WHEN** a state reuses the last confirmation's message ID with another state, and a confirmation is stamped a minute before the last one
- **THEN** the first writes a change row, and the second leaves the last confirmation's time as it was, so the next silence is measured from it

#### Scenario: The previous release in between
- **WHEN** a store this release wrote is opened and written by the release before it, then by this release again
- **THEN** the previous release starts, writes a row per reading and leaves the span table alone, and this release resets the span of each entity it took a reading of to an unknown start, keeps the others, carries a reset span on its next change row and keeps one gapless order
