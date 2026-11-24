## MODIFIED Requirements

### Requirement: Curated personas and current context
The owner SHALL inspect stable bunny, reachy and microduck profiles and explicitly request a bounded versioned context document with current active knowledge/preferences and selected permitted conversation messages. Voice references SHALL remain independent of models. Data SHALL confer no authority or current location evidence. The owner SHALL be able to turn the knowledge notes on or off for each companion's model context, off until the owner turns them on, and the profiles document SHALL name the companions whose context holds them ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). The Companion knowledge page SHALL preview a companion's model context from the assistant's context builder, as the assistant-tasks capability specifies, apart from the context document for copying.

#### Scenario: Context is selected and refreshed
- **WHEN** a selected message is corrected or removed, or knowledge is deactivated, before the next context read
- **THEN** the read uses current records, excludes removed/inactive content and other personas' private conversations, and returns explicit denied/unavailable results rather than invented recall
- **AND** no whole history or persistent context cache is used; knowledge entries reach a companion's model prompt only while the owner has turned them on for it, and conversation messages only as its own conversation's recent section, as the assistant-tasks capability specifies

#### Scenario: Knowledge switch per companion
- **WHEN** the owner turns knowledge notes on for B.U.N.N.Y. from the Companion knowledge page and previews its model context
- **THEN** the profiles document names B.U.N.N.Y. alone, the preview shows the knowledge notes section with what it sends, and Reachy's context keeps it off

### Requirement: Additive private recovery
The owner SHALL export/import a closed versioned private archive atomically. Existing entries, history, active state, local voice selections and message corrections SHALL win. Missing knowledge/preferences SHALL arrive inactive, and imported messages SHALL remain historical and require explicit context selection. Known removals SHALL defeat imported content and exports SHALL contain removal metadata without deleted text. An archive MAY hold several conversations of one profile, its current one and earlier ones; an import SHALL NOT move a profile's current conversation, and a profile without one SHALL take the archive's latest ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)).

#### Scenario: Repeated old and current archives
- **WHEN** an archive is imported into the same or an empty store, repeated, or followed by an older archive
- **THEN** existing records remain unchanged, missing entries are inactive, known message removals persist, and incompatible identity/order refuses the whole file
- **AND** fresh recovery documents that an old file alone cannot know later deletions

#### Scenario: Refused or interrupted changes
- **WHEN** validation, version, revision, capacity, full-disk or transaction checks fail
- **THEN** there is no partial change, history truncation or successful receipt; committed writes awaiting publication remain committed

#### Scenario: Earlier conversations of a profile
- **WHEN** an archive holding a profile's earlier and current conversations is imported into an empty store and into its own store
- **THEN** both are accepted, the earlier conversation is readable in each, and the current conversation is the archive's latest in the empty store and unchanged in its own
