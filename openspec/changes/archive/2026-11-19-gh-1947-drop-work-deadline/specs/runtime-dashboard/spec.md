## MODIFIED Requirements

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. It SHALL read every record through the contracts package's shared session read function. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, how long ago the hub last heard from it (the age of the record's `lastEvidenceAtMs` against the page's own clock, in whole minutes, with no polling and no read of its own; Hub #1947), a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the work state, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, work state, the same evidence age, read evidence, parent and children. A row SHALL be marked uncertain only when its status is `unknown`, its work is unconfirmed or the copy is not synced; silence SHALL NOT mark any row uncertain; its evidence age shows it instead. Habitat and the Connections notice override SHALL use the same rule.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears quiet, then working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

#### Scenario: Silence marks no row, and only unconfirmed work does
- **WHEN** one session waits on a question, one holds an unread finished turn and one works, all three stay silent for ten minutes, and a fourth's work a core restart left unconfirmed
- **THEN** only the fourth row is marked uncertain, silence marks none of the other three, each of the three faces says the hub heard from it ten minutes ago, and the notice override stays available for the finished session

#### Scenario: Evidence age from the page's clock
- **WHEN** the page shows a session whose record's evidence time is 59 seconds, one minute, and one hour and seven minutes before the page's clock
- **THEN** its face reads Heard <1m ago, Heard 1m ago and Heard 1h 7m ago (a closed Home tile drops the leading word), counting up with the page's clock without another read
