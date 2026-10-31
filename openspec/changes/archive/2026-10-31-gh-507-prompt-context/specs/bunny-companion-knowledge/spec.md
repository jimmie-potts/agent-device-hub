## MODIFIED Requirements

### Requirement: Curated personas and current context
The owner SHALL inspect stable bunny, reachy and microduck profiles and explicitly request a bounded versioned context document with current active knowledge/preferences and selected permitted conversation messages. Voice references SHALL remain independent of models. Data SHALL confer no authority or current location evidence.

#### Scenario: Context is selected and refreshed
- **WHEN** a selected message is corrected or removed, or knowledge is deactivated, before the next context read
- **THEN** the read uses current records, excludes removed/inactive content and other personas' private conversations, and returns explicit denied/unavailable results rather than invented recall
- **AND** no whole history, persistent context cache or automatic injection of knowledge entries or conversation messages into the assistant graph is used; the curated persona and active preferences reach the assistant's model prompt only as the assistant-tasks capability specifies
