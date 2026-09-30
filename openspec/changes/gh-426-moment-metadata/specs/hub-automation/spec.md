## ADDED Requirements

### Requirement: Bounded event display metadata
The existing normalized event intake SHALL optionally accept `pullRequestTitle` and `meetingTitle`, each at most 160 Unicode scalars, and `repositoryName`, at most 80. Each present field SHALL be nonempty display text that passes the shared lifecycle contract's Unicode, control-character and recognizable-credential checks. Invalid or overlong metadata and undeclared content fields SHALL reject the event as `invalid-event` before consuming its deduplication key. Absent fields SHALL preserve legacy event behavior. Display metadata SHALL NOT change event matching, identity, replay protection, arbitration or the controller contract 1.1 sender intent. The lifecycle source SHALL continue to supply neutral IDs without capturing additional content.

Only own data properties SHALL supply display metadata. Inherited fields SHALL be omitted, and metadata accessors SHALL be rejected without being invoked. The intake SHALL validate the same values it copies into the normalized event.

#### Scenario: Named pull request and meeting moments
- **WHEN** a live event carries a valid pull request title and repository name, or a valid meeting title, and matches an enabled rule
- **THEN** each target's private log entry includes those fields in its event, including when arbitration blocks delivery
- **AND** the sender receives only the existing controller moment intent fields

#### Scenario: Invalid metadata leaves the event ID available
- **WHEN** an event supplies a recognizable credential, empty text, invalid Unicode, a control character, a value beyond its scalar bound, or an undeclared prompt, response, transcript or attendee field
- **THEN** the intake returns `invalid-event`, stores no log entry and sends nothing
- **AND** a later valid event with the same source and ID may be evaluated once

#### Scenario: Restart and legacy log compatibility
- **WHEN** the Hub reopens its private store containing legacy log rows and named event rows
- **THEN** legacy rows retain their prior shape and named rows return the same optional display fields without inferred or backfilled names
- **AND** renamed metadata on an already accepted event remains a duplicate, and replayed named events trigger no rule

#### Scenario: Metadata remains private and allowlisted
- **WHEN** an accepted named event is logged with sender evidence
- **THEN** the existing bounded log stores only its declared display fields beside the allowlisted sender projection under the existing owner lease
- **AND** metadata alone creates no new table, live-state migration, credential exposure, content-capture capability or device writer

#### Scenario: Source objects cannot bypass metadata validation
- **WHEN** an in-process source supplies inherited display metadata or an accessor for a display field
- **THEN** inherited fields are not copied, and accessors reject the event without being invoked
- **AND** unchecked credentials or overlong values cannot enter the log through either path
