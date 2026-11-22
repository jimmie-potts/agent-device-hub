## ADDED Requirements

### Requirement: Track Conversation artwork upload and save

Conversation artwork SHALL use profile 2.0 tracked commands for upload preparation and promotion into the library. Binary media SHALL stay on the authenticated upload and content routes.

#### Scenario: Separate commands for a single artwork

- **WHEN** a validated attachment is saved and displayed
- **THEN** upload, save and display requests use distinct request identities and reference the same artwork
- **AND** each selected display has independent tracked preparation and display evidence
