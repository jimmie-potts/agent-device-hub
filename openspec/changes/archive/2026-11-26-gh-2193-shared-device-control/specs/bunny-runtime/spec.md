## ADDED Requirements

### Requirement: Shared device facts and tracked command admission

The runtime SHALL expose the device lookup to read-scoped MCP clients using the current registered owner's SDK state. A named device SHALL include exact identity, declared capabilities and applicable value constraints, availability and observation currentness. MCP and Conversation SHALL use the same tracker admission for new supported device actions and preserve their respective principals, control grants, payload identity and device writer.

#### Scenario: A device is inspected and controlled across clients

- **WHEN** equally authorized Conversation and MCP callers inspect the same configured device
- **THEN** they receive equivalent identity, capability, availability and observation evidence
- **AND** an invalid, conflicting or held request reaches no device writer, while repeating an admitted request ID retains the previous result without sending another command
