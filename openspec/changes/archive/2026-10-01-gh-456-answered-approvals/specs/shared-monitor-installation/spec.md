## MODIFIED Requirements

### Requirement: Reviewed reversible configuration

Setup SHALL provide inspect, plan, apply and remove operations for explicitly named Linux/WSL client files. Plans MUST show the exact owned hook additions/removals and precondition digest. Apply MUST preserve unrelated hooks and trust settings, retain private backups outside Git and reject concurrent edits or ambiguous ownership. Removal MUST use current configuration rather than restore an old whole-file backup.

#### Scenario: User edits between installation and removal
- **WHEN** the user removes an unrelated hook and adds a different hook after setup
- **THEN** removal deletes only unchanged owned entries and preserves both user changes

#### Scenario: Conflicting plan or ownership
- **WHEN** a target changes after planning or an owned entry is edited
- **THEN** setup refuses to overwrite the changed configuration

#### Scenario: Installed receipt from the previous event list
- **WHEN** setup is re-applied on an installed Claude receipt that lacks the two tool-completion events
- **THEN** it adds exactly those entries and keeps the credential, and the receipt remains inspectable and removable before the re-apply
