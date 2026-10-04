## ADDED Requirements

### Requirement: Versioned host session reads
The authenticated session route SHALL accept `snapshotVersion=1.3` and return the owner's snapshot 1.3, including each record's optional `hostSessionId`. The default, 1.1 and 1.2 projections SHALL remain unchanged. Owner enrichment of Codex Desktop titles SHALL preserve a 1.2 envelope version.

#### Scenario: Version selection
- **WHEN** old and new clients read the sessions route after a Desktop event
- **THEN** only clients selecting 1.3 receive `hostSessionId`
