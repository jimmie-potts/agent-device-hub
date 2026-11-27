## ADDED Requirements

### Requirement: Conversation uses the runtime device lookup

Conversation SHALL use the shared device lookup for supported device facts, and SHALL apply its active context-sharing and tool grants to every returned field. Proposals SHALL continue to use guarded device identity and the existing tracker, approval and receipt flow.

#### Scenario: Device details are outside the conversation grant

- **WHEN** a model asks for device details that the active Conversation sharing policy excludes
- **THEN** the model receives no excluded fields, even if a different client has authority to read them

#### Scenario: The supervisor reads the selected light's current controls

- **WHEN** the owner names one light and the selected supervisor has permission for its current device status
- **THEN** the supervisor can read the light's supported controls, advertised bounds and current observations for the request
- **AND** historical timestamp permission is unnecessary for those current facts, while denying current status withholds them

#### Scenario: The scoped reader selects a Wemo plug

- **WHEN** the selected supervisor has current-status and power-control grants for one Wemo plug
- **THEN** its facts include that plug's power support, allowed action and current guards, plus its existing maximum-on information when available
