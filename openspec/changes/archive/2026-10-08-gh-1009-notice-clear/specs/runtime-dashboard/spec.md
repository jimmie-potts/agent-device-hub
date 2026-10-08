## ADDED Requirements

### Requirement: Confirmed Connections notice override
Connections SHALL offer an Operator tools override labeled `Clear this notice on every device` for a selected session. It SHALL require confirmation against the selected notice and revision, disable submission without current synced session evidence or control authority, and keep the session row passive. Requested state, transport reply, operation completion and acknowledgment evidence SHALL remain distinct. The result SHALL come from matching current operation and session copies, never the accepted reply alone. Reload, reconnect and lost response SHALL send no automatic retry. The override SHALL prove neither provider readership nor physical device success.

#### Scenario: Confirm and observe
- **WHEN** the operator confirms clearing a selected notice
- **THEN** one command is sent and the recorded acknowledgments clear the passive session row, with completion and synced consumer evidence shown separately from acceptance

#### Scenario: Changed selection or unavailable authority
- **WHEN** the notice changes before confirmation, current evidence is unavailable, or the connection is read-only
- **THEN** submission is disabled or refused without silently switching to a new notice

#### Scenario: Keyboard and recovery
- **WHEN** the operator uses the keyboard to confirm or cancel, or reconnects/reloads after a lost reply
- **THEN** focus and accessible status remain usable, and recovery sends no command
