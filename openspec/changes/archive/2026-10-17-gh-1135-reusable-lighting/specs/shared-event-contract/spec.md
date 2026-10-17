## ADDED Requirements

### Requirement: Lighting layout metadata families

Profile 2.0 SHALL define `lighting-layout` state and `lighting-layout-set` command families for the core's private lighting composition. The state SHALL identify its entity and revision and carry bounded room definitions, device-to-room assignments, per-view custom groups and Home selections. The command SHALL identify the request, require an expected revision and carry the complete replacement layout. Closed schemas and semantic validation SHALL reject duplicate identities, invalid references, excessive membership and malformed values. These families SHALL contain no device addresses, credentials or executable behavior.

#### Scenario: Valid saved composition
- **WHEN** a current layout and a correctly guarded replacement command are validated
- **THEN** both use profile 2.0, the core is the single state owner, and the command describes metadata only

#### Scenario: Invalid replacement layout
- **WHEN** a replacement has duplicate room/group identities, invalid room references, overlapping same-view group membership or an undeclared field
- **THEN** validation refuses it before a save or device effect
