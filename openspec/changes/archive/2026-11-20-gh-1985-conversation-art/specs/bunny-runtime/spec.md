## ADDED Requirements

### Requirement: Private Conversation art dispatch

The tracker SHALL admit `art-request/2.1` only from `bunny/modules/companions`. The approved description SHALL reach the Art module in the command and SHALL be omitted from stored core operations and history. The tracker SHALL use a distinct private digest domain for duplicate admission, and the omitted data SHALL NOT be available for resend.

#### Scenario: A Conversation art request is repeated

- **WHEN** the companions module repeats an identical approved request ID
- **THEN** the tracker returns the known reply without forwarding it again, and retained core records omit the approved description
