## MODIFIED Requirements

### Requirement: Explicit handling and send-again

The bounded core handling command, gateway, MCP and dashboard SHALL use one handling path that records its actor and publishes a deleted removal. Send-again SHALL use saved operation data and a new request ID for ordinary commands. An omitted ONN focused-text payload SHALL be refused before handling the original item; the owner can enter fresh text with a new request ID. Its initial tracked sent row and original handling SHALL commit together before transmission. No restart, reload, reconnect or timeout SHALL resend a command automatically.

#### Scenario: Atomic explicit resend
- **WHEN** two callers handle the same revision or the initial resend commit fails
- **THEN** at most one new tracked command is sent, and a failed initial commit preserves the original item

#### Scenario: Omitted text cannot be resent
- **WHEN** a client requests Send again for an omitted ONN text operation
- **THEN** the operation is refused before handling or transmission; the original item remains and Dismiss still works
