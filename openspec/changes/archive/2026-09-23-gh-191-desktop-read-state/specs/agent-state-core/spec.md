## ADDED Requirements

### Requirement: Read evidence separate from observation freshness
The owner SHALL apply `read.observed` only to the session's read dimension. A read observation MUST NOT refresh observation age, freshness or the session's observed timestamp, MUST NOT clear restart uncertainty, and MUST NOT create a session for an unknown identity. The latest accepted read observation SHALL set `read` to `read` or `unread` without acknowledging or removing notices.

#### Scenario: Read observation on an old session
- **WHEN** a session has been without lifecycle evidence for five minutes and then receives a read observation
- **THEN** its read value changes while its observation age keeps increasing and it stays uncertain

#### Scenario: Read observation after restart
- **WHEN** the owner restarts from saved state and a read observation arrives before any lifecycle evidence
- **THEN** the session reports the new read value and remains restart-uncertain

#### Scenario: Read observation for an unknown identity
- **WHEN** a read observation names a session the owner does not hold
- **THEN** no session is created and no loss is counted

#### Scenario: Read value changes back
- **WHEN** a session observed as read is later observed as unread
- **THEN** it reports unread and its notices and acknowledgments are unchanged
