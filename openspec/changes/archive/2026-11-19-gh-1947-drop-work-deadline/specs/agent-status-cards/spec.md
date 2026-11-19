## MODIFIED Requirements

### Requirement: Attention and freshness remain distinct
Cards with approval, input or question attention SHALL have amber highlighting and written attention labels; a session that needs the owner for a detail this version does not know SHALL show **Needs you** in the same blocked color. Home SHALL omit a separate attention panel. A card SHALL show the hub's shared status and SHALL NOT age it: a working session whose work is unconfirmed SHALL say **Unconfirmed** and add no current working count, a session whose status is unknown SHALL be marked uncertain, and only a session copy that is not synced SHALL say **Stale**. Silence SHALL NOT mark any session (Hub #1947); the face SHALL instead show how long ago the hub last heard from the session, from the record's evidence time against the page's clock. The summary SHALL exclude unconfirmed or unsynced work from current working counts and SHALL count retained unread evidence independently of higher-priority attention or activity.

#### Scenario: Current attention
- **WHEN** a session needs input, approval or a question answered
- **THEN** its own card is highlighted and opening it retains the highlight

#### Scenario: Stale and unread evidence
- **WHEN** an active session's work is unconfirmed, or the session copy is not synced
- **THEN** the face says Unconfirmed for the unconfirmed work and Stale for the unsynced copy, and neither contributes a current working count; retained unread evidence is not acknowledged by inspection

#### Scenario: Silence on a waiting or finished session
- **WHEN** a session waiting on a question, a session holding an unread finished turn and a working session stay silent for ten minutes on a synced copy
- **THEN** their faces keep Question, Finished · unread and Working, none is marked uncertain, and each says Heard 10m ago
