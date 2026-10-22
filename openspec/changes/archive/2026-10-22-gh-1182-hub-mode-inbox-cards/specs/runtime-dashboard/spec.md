## MODIFIED Requirements

### Requirement: The approved home with its panels

The home SHALL follow the owner-approved mockup ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode panel and the agent sessions in the wide column, the inbox panel in the narrow one. Attention SHALL be highlighted on each agent card with an amber surface and written state, without a separate attention panel. The Hub mode card SHALL show the synced saved selection and matching artwork with explicit Work/Free/Quiet controls, including same-mode reapplication. Its concise face SHALL omit routine request sections and device lists; saved choice SHALL remain distinct from device results, with related issues available through its corner Check Inbox control and shared Inbox evidence. The Inbox card SHALL retain #923's synced failed, uncertain and conflicting operations with expandable evidence and explicit handling controls. An empty synced inbox SHALL say that no commands need handling. Both cards SHALL use reusable presentation over existing shared state and adapters.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the wide column holds the Hub mode and the sessions, the narrow one the inbox without a separate attention panel, and the sessions say none were observed

### Requirement: Explicit mode selection with separate outcomes

The mode controls SHALL require a current synced selection, a live connection and control authority. Selecting a mode SHALL send once with a new request ID and the current selection revision. A reply SHALL NOT prove device success. The concise panel SHALL keep individual device results in shared Inbox and Timeline evidence, with a corner link for issues. Missing or unsynced evidence SHALL NOT establish device success or resolution. Reload, refresh and reconnect SHALL send nothing. Keyboard access and the changed control's accessibility SHALL be verified.

#### Scenario: Select and reload
- **WHEN** an operator selects Work using the keyboard and reloads after one device succeeds and another fails
- **THEN** Work remains the saved choice, the failed device remains reviewable through Inbox and independent results remain available in Timeline, reload sends nothing and the changed control has no applicable accessibility violations

#### Scenario: Read-only view
- **WHEN** a read-only connection opens the panel
- **THEN** it can read the saved selection and inspect shared Inbox and Timeline results, its mode controls are disabled and it sends nothing
