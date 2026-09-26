## ADDED Requirements

### Requirement: Versioned title and project session reads
The authenticated session route SHALL support snapshotVersion=1.2 with title/project metadata while retaining the existing default projection. Label commands SHALL enforce the same 80-scalar bound as the owner.

#### Scenario: Version selection
- **WHEN** old and new clients read sessions
- **THEN** only clients selecting 1.2 receive the new fields

#### Scenario: Label bound
- **WHEN** a client submits a label with 80 Unicode scalars or 81
- **THEN** the former passes the text bound and the latter rejects before state mutation
