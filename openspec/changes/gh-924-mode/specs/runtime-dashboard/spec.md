## MODIFIED Requirements

### Requirement: The approved home with its panels

The home SHALL follow the owner-approved mockup ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode panel and the agent sessions in the wide column, the inbox panel and the attention summary in the narrow one. The Hub mode panel SHALL show the synced saved selection with explicit Work/Free/Quiet controls. It SHALL distinguish the saved choice from independently tracked device results. The inbox (#923) panel SHALL be a slot that its story fills: it SHALL say it is not shown on the page yet, and SHALL read and send nothing. The page SHALL NOT claim the inbox is empty.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the wide column holds the Hub mode and the sessions, the narrow one the inbox and the attention summary, and the sessions say none were observed

## ADDED Requirements

### Requirement: Explicit mode selection with separate outcomes

The mode controls SHALL require a current synced selection, a live connection and control authority. Selecting a mode SHALL send once with a new request ID and the current selection revision. A reply SHALL NOT prove device success. The panel SHALL show each available matching tracked device result independently and SHALL label missing or unsynced evidence honestly. Reload, refresh and reconnect SHALL send nothing. Keyboard access and the changed control's accessibility SHALL be verified.

#### Scenario: Select and reload
- **WHEN** an operator selects Work using the keyboard and reloads after one device succeeds and another fails
- **THEN** Work remains the saved choice, the separate device results are shown, reload sends nothing and the changed control has no applicable accessibility violations

#### Scenario: Read-only view
- **WHEN** a read-only connection opens the panel
- **THEN** it can read the saved selection and results, its mode controls are disabled and it sends nothing
