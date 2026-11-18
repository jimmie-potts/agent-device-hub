## MODIFIED Requirements

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. It SHALL read every record through the contracts package's shared session read function. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the work state, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, work state, the age of its last evidence, read evidence, parent and children. A row SHALL be marked uncertain only when its status is `unknown`, its work is unconfirmed or the copy is not synced; a session that waits for the owner or holds a finished turn SHALL NOT be marked uncertain by silence. Habitat and the Connections notice override SHALL use the same rule.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears quiet, then working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

#### Scenario: Silence marks only work
- **WHEN** one session waits on a question, one holds an unread finished turn and one works, and all three stay silent for ten minutes
- **THEN** only the working row is marked uncertain, and the notice override stays available for the finished session
