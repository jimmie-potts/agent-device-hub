## ADDED Requirements

### Requirement: Playback layout metadata families

Profile 2.0 SHALL define core-owned playback-layout state and playback-layout-set command families for bounded explicit music-card placements. State SHALL identify the playback layout and its revision and carry bounded logical playback IDs and room IDs. The command SHALL identify its request, require an expected revision and carry the complete replacement placement metadata. Closed schemas and semantic validation SHALL reject duplicate identities, duplicate room membership, malformed IDs and excessive membership. These families SHALL contain no room names, speaker addresses, credentials, media or executable behavior. Saves SHALL use operator authority, expiry and revision guards and commit private state with its tracked outcome before publication. Layout outcomes SHALL establish metadata effects only, never audio routing or playback effects, and an uncertain command SHALL never be replayed.

#### Scenario: Valid placement and conflicting replacement
- **WHEN** an authorized current-revision replacement is admitted, followed by an obsolete-revision replacement
- **THEN** only the first layout commits with its outcome, the obsolete request is refused revision-conflict, and neither sends a playback command

#### Scenario: Invalid or interrupted placement
- **WHEN** a request contains invalid or duplicate membership, lacks operator admission, expires before saving or fails storage before commit
- **THEN** the existing typed refusal leaves committed state unchanged; a lost reply retains uncertainty until reconciled and never causes automatic resend
