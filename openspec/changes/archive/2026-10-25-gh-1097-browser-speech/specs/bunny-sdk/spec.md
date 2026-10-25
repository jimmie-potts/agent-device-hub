## ADDED Requirements

### Requirement: Connection-bound browser endpoint
The remote SDK SHALL support explicitly opened endpoint handlers and receipt publication on its existing authenticated HTTP and SSE connection. Endpoint authority SHALL be restricted to declared calls, routing families and the current stream identity. Every endpoint call SHALL verify the authenticated principal and current connection. Normal read and control grants SHALL NOT imply endpoint authority. Endpoint handlers SHALL be retired on disconnect and SHALL NOT be restored by reconnect or sync.

#### Scenario: Scoped authority
- **WHEN** a client attempts an endpoint call for another connection, a different authenticated principal, an undeclared family or an expired stream
- **THEN** the edge refuses it using the shared error body without delivering a command or publishing a receipt

#### Scenario: Disconnect and reconnect
- **WHEN** a connection with an endpoint handler ends and the remote client reconnects
- **THEN** existing ordinary subscriptions can recover but endpoint authority and handlers remain closed until another explicit open
- **AND** no previous endpoint command is resent

#### Scenario: Mounted module lifetime
- **WHEN** the page that opened a permitted endpoint unmounts or loses control authority
- **THEN** its handlers close and it cannot publish a new endpoint receipt or receive another command
