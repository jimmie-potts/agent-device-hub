## ADDED Requirements

### Requirement: Shared command lifecycle
Draft forms and one-click actions SHALL follow one command lifecycle. Each deliberate activation MUST send at most one request, built from a fresh read, and a second activation while a command is running MUST send nothing. A blocked, failed or throwing preparation MUST send nothing, MUST say that nothing changed and MUST leave the control usable. Only an accepted ticket SHALL be watched for a later terminal receipt. A refresh that fails after a command result MUST keep that result, MUST NOT imply that nothing was sent and MUST NOT resend the command. The next explicit activation MUST read current guards again. No transition SHALL retry a command automatically.

#### Scenario: Failed fresh read before sending
- **WHEN** the device read taken just before sending a form or an action fails
- **THEN** nothing is sent, the status says nothing changed, a form keeps its draft, and once reads recover one explicit activation sends with current guards

#### Scenario: Failed refresh after a result
- **WHEN** a form's or an action's command is accepted and the refresh that follows it fails
- **THEN** the accepted status remains, the control is released, and no command is resent

#### Scenario: Rejected ticket and another client's receipt
- **WHEN** a command is rejected and another client's receipt for the same ticket later appears
- **THEN** that receipt is not shown as this command's outcome

#### Scenario: Double activation
- **WHEN** the user activates a one-click action twice in quick succession
- **THEN** exactly one command is sent
