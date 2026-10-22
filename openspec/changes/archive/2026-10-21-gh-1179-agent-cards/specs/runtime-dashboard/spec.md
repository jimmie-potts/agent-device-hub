## MODIFIED Requirements

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the activity, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, activity, the age of its last evidence, read evidence, parent and children.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

### Requirement: The approved home with its panels

The home SHALL follow the owner-approved mockup ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode panel and the agent sessions in the wide column, the inbox panel in the narrow one. Attention SHALL be highlighted on each agent card with an amber surface and written state, without a separate attention panel. The Hub mode panel SHALL show the synced saved selection with explicit Work/Free/Quiet controls. It SHALL distinguish the saved choice from independently tracked device results. The inbox panel SHALL retain #923's synced failed, uncertain and conflicting operations and its explicit handling controls. An empty synced inbox SHALL say that no commands need handling.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the wide column holds the Hub mode and the sessions, the narrow one the inbox without a separate attention panel, and the sessions say none were observed
