## MODIFIED Requirements

### Requirement: Lighting layout metadata families

Profile 2.0 SHALL define `lighting-layout` state and `lighting-layout-set` command families for the core's private lighting composition. The state SHALL identify its entity and revision and carry bounded room definitions, device-to-room assignments, per-view custom groups and Home selections. The command SHALL identify the request, require an expected revision and carry the complete replacement layout. Version 2.1 SHALL add an optional `plugs` list on a group, naming each member that is a plug with the module that owns it; a group's `devices` SHALL still list every member. Each plug entry SHALL name one of its own group's devices, appear once and belong to a Home group. The 2.0 schema SHALL remain unchanged, the core SHALL publish 2.1, and `lighting-layout-set/2.0` SHALL accept the 2.1 layout as an additive optional field. Closed schemas and semantic validation SHALL reject duplicate identities, invalid references, excessive membership and malformed values. These families SHALL contain no device addresses, credentials or executable behavior.

#### Scenario: Valid saved composition
- **WHEN** a current layout and a correctly guarded replacement command are validated
- **THEN** both use profile 2.0, the core is the single state owner, and the command describes metadata only

#### Scenario: Invalid replacement layout
- **WHEN** a replacement has duplicate room/group identities, invalid room references, overlapping same-view group membership or an undeclared field
- **THEN** validation refuses it before a save or device effect

#### Scenario: A Home group with a plug
- **WHEN** a layout names a plug member of a Home group in its `plugs`
- **THEN** 2.1 and the set command accept it, 2.0 rejects it, and a plug entry outside its group's devices, listed twice, owned by a non-module source or on a brand group is refused
