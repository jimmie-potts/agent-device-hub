## MODIFIED Requirements

### Requirement: Status tile from the synced sessions

The module SHALL keep a synced copy of the core's `session` records, read them through the contracts package's shared session read function, and draw the status tile from it with the runner's layout: up to four rows of root sessions, `ASK`, `RUN` and `DONE` in that order and newest evidence first, `+N MORE` past four, labels by the owner-resolved label, title, project display name, legacy project ID, then the 1.x neutral hashed ID. Any consumer's acknowledgment SHALL retire `DONE`, and read evidence SHALL NOT. A session SHALL be dimmed with a `?` marker only when its status is `unknown` or its work is unconfirmed; a session that waits for the owner or holds a finished turn SHALL NOT be marked by silence. While the copy has not synced, or after a later sync failed, every row SHALL be dimmed, or the tile SHALL read `FEED ?`, and the tile SHALL NOT be removed. When the copy shows nothing to display, the tile SHALL leave the rotation.

#### Scenario: Sessions shown
- **WHEN** the copy holds a session asking, one working, one with an unacknowledged finished turn, an idle one and a child
- **THEN** the tile shows ASK, RUN and DONE rows in that order, without the idle session or the child, and its frame equals the frame the copy calls for

#### Scenario: A quiet question is not uncertain
- **WHEN** a session has waited on a question for ten minutes and another's work turned unconfirmed
- **THEN** the ASK row has no `?` marker and the RUN row has one

#### Scenario: A lost copy
- **WHEN** the copy stops following the core after a sync it refuses
- **THEN** the next push dims every row, the module logs one feed failure, and the tile is never removed while the copy is lost

#### Scenario: No sync at all
- **WHEN** the core refuses every sync of the sessions for 30 s after the start, and comes up later
- **THEN** the tile writes nothing for those 30 s, then reads `FEED ?`, the module syncs again after its backoff and logs one recovery, and the next push, after the 15-second gate, shows the sessions
