## ADDED Requirements

### Requirement: Model-interpreted Conversation catalog

Either registered supervisor SHALL receive the configured tools for the supported Conversation catalog. A migrated action SHALL remain bound to the current authenticated request, an eligible registered owner and target, the validated settings and the existing owner revision or generation. The Hub SHALL preserve existing approvals and field-specific sharing. A private draft mutation SHALL use its guarded revision and SHALL send no device command.

#### Scenario: A catalog operation uses a current owner request

- **WHEN** the owner asks for a supported operation and the supervisor supplies a unique target and valid settings
- **THEN** the Hub sends the existing guarded owner command through the tracked dispatcher once
- **AND** the private result follows the owner's existing evidence contract

#### Scenario: A hosted catalog proposal cites the current target words

- **WHEN** the hosted supervisor proposes a catalog effect against an existing target
- **THEN** it cites the verbatim words selecting each target in the current authenticated owner request or its clarification, with the corresponding primary or nested role
- **AND** the Hub checks each cited source and resolves current named targets in their owner-local permitted records before dispatch
- **AND** absent, inaccessible, ambiguous or conflicting named targets send no command and require clarification

#### Scenario: Earlier context identifies a genuine reference

- **WHEN** a current target phrase refers back to an eligible record in the same conversation
- **THEN** eligible prior context may identify that record for the cited role
- **AND** a pronoun in another instruction cannot replace an absent or conflicting name in the current selection

#### Scenario: A stale draft edit or invalid target is proposed

- **WHEN** the supervisor proposes a stale draft revision, an invalid target, or a target whose permission has changed
- **THEN** the Hub sends no device command and leaves the affected draft unchanged

#### Scenario: A stored scene or original is requested by name

- **WHEN** the current owner asks to activate a saved Nanoleaf scene on an eligible light or change an original Pixoo asset by name
- **THEN** Companions resolves the name through the selected owner and binds its opaque ID before using the existing tracked command
- **AND** private catalog names and records remain out of the hosted supervisor's results
- **AND** an ambiguous match prompts for clarification and sends no command
