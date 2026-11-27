## ADDED Requirements

### Requirement: Conversation uses the runtime device lookup

Conversation SHALL use the shared device lookup for supported device facts, and SHALL apply its active context-sharing and tool grants to every returned field. Proposals SHALL continue to use guarded device identity and the existing tracker, approval and receipt flow.

#### Scenario: Device details are outside the conversation grant

- **WHEN** a model asks for device details that the active Conversation sharing policy excludes
- **THEN** the model receives no excluded fields, even if a different client has authority to read them
