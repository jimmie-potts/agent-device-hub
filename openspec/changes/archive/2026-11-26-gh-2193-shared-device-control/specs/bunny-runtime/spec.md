## ADDED Requirements

### Requirement: Shared device facts and tracked command admission

The runtime SHALL expose the device lookup to read-scoped MCP clients using the current registered owner's SDK state. A named device SHALL include exact identity, declared capabilities and applicable value constraints, availability and observation currentness. MCP and Conversation SHALL use the same tracker admission for new supported device actions and preserve their respective principals, control grants, payload identity and device writer.

#### Scenario: A device is inspected and controlled across clients

- **WHEN** equally authorized Conversation and MCP callers inspect the same configured device
- **THEN** they receive equivalent identity, capability, availability and observation evidence
- **AND** an invalid, conflicting or held request reaches no device writer, while repeating an admitted request ID retains the previous result without sending another command

#### Scenario: A relative device command supplies the identified observation

- **WHEN** a client sends a brightness or color-temperature change computed from a current reading
- **THEN** the runtime SHALL check the exact observed time and value, target configuration and generation, plus pending and newer effects for the selected target before any send
- **AND** a stale basis causes zero effects and needs a fresh reading and request, while an exact replay retains the original receipt

#### Scenario: A device publishes a bounded catalog preview

- **WHEN** a client supplies an exact playlist ID absent from the Pixoo preview
- **THEN** the designated owner checks its complete catalog before admitting the action

#### Scenario: An owner-local edit targets an offline device

- **WHEN** an authorized client submits a supported library or layout edit for an offline device with no hold
- **THEN** the existing owner SHALL validate and apply its local edit
- **AND** commands that require an available device and commands against a hold still follow their existing admission rules
