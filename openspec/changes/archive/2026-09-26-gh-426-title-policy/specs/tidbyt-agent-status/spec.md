## MODIFIED Requirements

### Requirement: Private labels
Each row SHALL be labelled with the session's explicit label, otherwise `title.value`, otherwise the project display name, otherwise its legacy project ID, otherwise a neutral ID derived by hashing its identity. The label SHALL use the existing font normalization and ten-character bound beside the state word within fourteen text columns. The view MUST NOT draw credentials, tokens, contact details or arbitrary snapshot text. The Tidbyt runner SHALL explicitly request snapshot 1.2 through the shared feed and validate that version; existing shared-feed consumers SHALL retain their default request unless they select a version.

#### Scenario: Titled session
- **WHEN** a working snapshot 1.2 session has a title and project but no explicit label
- **THEN** its row shows the normalized title within ten characters and preserves the state word

#### Scenario: Explicit label
- **WHEN** a session has a label, title and project
- **THEN** the row shows the label

#### Scenario: Project fallback
- **WHEN** a session has no label or title but has a project display name and legacy project ID
- **THEN** the row shows the project display name

#### Scenario: Neutral ID
- **WHEN** a session has no label, title, project display name or project ID
- **THEN** its row shows `C` for Claude or `X` for Codex and four hex digits of the identity hash, and none of its identity fields appear in the frame text

#### Scenario: Versioned feed
- **WHEN** Tidbyt reads the selected owner's shared feed
- **THEN** it requests snapshot 1.2 and validates the returned title/project metadata, treating a failed or mismatched response as unavailable without sending commands during the read
