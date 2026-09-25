## MODIFIED Requirements

### Requirement: Reconnect without losing intent
The dashboard SHALL obtain authoritative snapshots on resync or expired cursors, reject superseded results, bound reconnect work, preserve focus and drafts for the same session generation, and keep slow/offline device status independent.

#### Scenario: Reconnect during editing
- **WHEN** the stream disconnects or resyncs while a user edits a field and the session generation is unchanged
- **THEN** updated evidence appears without resetting the field or focus or replaying commands

#### Scenario: Missed retirement while editing a task
- **WHEN** a current snapshot replaces a session with a different generation under the same identity
- **THEN** the old task label and acknowledgment drafts are discarded, the new task uses fresh defaults, and no command is submitted
- **AND** unrelated controller drafts and tasks remain intact

