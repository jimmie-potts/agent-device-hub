## ADDED Requirements

### Requirement: Session row label controls

The dashboard SHALL let a person set or clear a session's explicit label from its row using the current synced session revision. It SHALL show requested command, accepted reply and confirmed record evidence separately; an accepted transport answer alone SHALL NOT confirm a label. A conflict SHALL retain the draft and require a refreshed explicit attempt with a new request identity. Stale or disconnected rows SHALL disable submission. Reload and reconnect SHALL show durable labels without resending a command. Ending or replacing a session SHALL retire its editor. Controls SHALL support keyboard use and the dashboard's accessibility checks.

#### Scenario: Label and clear from the row
- **WHEN** a person saves a label and then clears it from a current session row
- **THEN** one command is sent per explicit action, requested and accepted evidence are distinct, and the synced record confirms the label and then its fallback

#### Scenario: Conflict and reconnect
- **WHEN** the row changes while its label draft is open or the stream is lost during submission
- **THEN** the draft remains available, stale submission is disabled, and resync does not resend; a conflict requires a new explicit attempt

#### Scenario: Reload and accessibility
- **WHEN** the person reloads after a confirmed label or uses the row controls with a keyboard
- **THEN** the durable label is displayed without another command, the controls remain usable and the page passes its browser accessibility checks
