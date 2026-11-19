## ADDED Requirements

### Requirement: Monitor uncertainty from the shared status

The Monitor SHALL read each session through the contracts package's shared session read function. A row SHALL carry the uncertain marker only when the copy's connection is not current, its status is `unknown`, its status is `working` with unconfirmed work, an unavailable warning applies to it, or its parent is ambiguous. Silence, an unknown parent of a root and an unknown turn SHALL NOT mark it. The children marker SHALL show only when the row's unconfirmed child count is above zero, a parent is ambiguous, or the connection is not current.

#### Scenario: A root that waits quietly
- **WHEN** a hook root with an unknown parent and turn waits on an approval for ten minutes on a current connection
- **THEN** its row shows the attention without the uncertain marker and without the children marker

#### Scenario: Unconfirmed work and a lost connection
- **WHEN** a working session's work turns unconfirmed, and then the copy stops following the core
- **THEN** the row is marked uncertain, and every row is marked once the connection is not current
