## ADDED Requirements

### Requirement: Shared session names and projects
Session views SHALL request snapshot 1.2 and display explicit labels before shared titles, then neutral fallbacks, with a separate shared project display name. Label forms SHALL enforce the 80-scalar bound. Existing identity/generation form keys, attention and freshness behavior SHALL remain unchanged.

#### Scenario: Title and project display
- **WHEN** a titled session without an explicit label has a project
- **THEN** the dashboard shows its title and project while a labelled fixture shows its owner label

#### Scenario: Untitled fallback
- **WHEN** a session has no label or title
- **THEN** the dashboard retains a distinct neutral identity fallback
