## MODIFIED Requirements

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. It SHALL read every record through the contracts package's shared session read function. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the work state, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, work state, the time since its last published change, labeled as such, read evidence, parent and children. A row SHALL be marked uncertain only when its status is `unknown`, its work is unconfirmed or the copy is not synced; a session that waits for the owner or holds a finished turn SHALL NOT be marked uncertain by silence. Habitat and the Connections notice override SHALL use the same rule.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears quiet, then working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

#### Scenario: Silence marks only work
- **WHEN** one session waits on a question, one holds an unread finished turn and one works, and all three stay silent for ten minutes
- **THEN** only the working row is marked uncertain, and the notice override stays available for the finished session

### Requirement: Session row label controls

The dashboard SHALL let a person set or clear a session's explicit label from its row using the current synced session revision. It SHALL show requested command, accepted reply and confirmed record evidence separately; an accepted transport answer alone SHALL NOT confirm a label. A conflict SHALL retain the draft and require a refreshed explicit attempt with a new request identity. An unsynced session copy or a pending attempt SHALL disable submission; the session's status, unknown or with unconfirmed work, SHALL NOT, because the label is the owner's own data and the expected-revision guard still refuses a changed record. Reload and reconnect SHALL show durable labels without resending a command. Ending or replacing a session SHALL retire its editor. Controls SHALL support keyboard use.

#### Scenario: Label and clear from the row
- **WHEN** a person saves a label and then clears it from a current session row
- **THEN** one command is sent per explicit action, requested and accepted evidence are distinct, and the synced record confirms the label and then its fallback

#### Scenario: Conflict and reconnect
- **WHEN** the row changes while its label draft is open or the stream is lost during submission
- **THEN** the draft remains available, submission is disabled while the copy is not synced, and resync does not resend; a conflict requires a new explicit attempt

#### Scenario: Reload and keyboard
- **WHEN** the person reloads after a confirmed label or uses the row controls with a keyboard
- **THEN** the durable label is displayed without another command and the controls remain usable

#### Scenario: Label on an uncertain session
- **WHEN** a session's status is unknown or its work is unconfirmed on a synced copy
- **THEN** its label can still be set or cleared, and a matching synced record confirms the label
