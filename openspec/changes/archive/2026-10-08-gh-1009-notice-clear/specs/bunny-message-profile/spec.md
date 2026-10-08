## ADDED Requirements

### Requirement: Guarded operator notice override family
The message profile SHALL define the closed `notice-clear/2.0` command payload with `requestId`, selected `noticeId` (a session notice identifier or null), and nonnegative `expectedRevision`. The qualified session entity ID SHALL be the subject, and completion SHALL use the existing outcome payload.

#### Scenario: Valid and invalid commands
- **WHEN** a sender names the selected notice and session revision
- **THEN** the command validates; missing guards, invalid notice identifiers, unqualified subjects and wire authority flags are refused
