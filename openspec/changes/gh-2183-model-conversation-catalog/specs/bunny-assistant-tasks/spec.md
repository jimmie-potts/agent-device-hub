## ADDED Requirements

### Requirement: Model-interpreted Conversation catalog

Either registered supervisor SHALL receive the configured tools for the supported Conversation catalog. A migrated action SHALL remain bound to the current authenticated request, an eligible registered owner and target, the validated settings and the existing owner revision or generation. The Hub SHALL preserve existing approvals and field-specific sharing. A private draft mutation SHALL use its guarded revision and SHALL send no device command.

#### Scenario: A catalog operation uses a current owner request

- **WHEN** the owner asks for a supported operation and the supervisor supplies a unique target and valid settings
- **THEN** the Hub sends the existing guarded owner command through the tracked dispatcher once
- **AND** the private result follows the owner's existing evidence contract

#### Scenario: A stale draft edit or invalid target is proposed

- **WHEN** the supervisor proposes a stale draft revision, an invalid target, or a target whose permission has changed
- **THEN** the Hub sends no device command and leaves the affected draft unchanged
