## ADDED Requirements

### Requirement: Quiet reusable companion cards
The dashboard SHALL render the same Reachy and MicroDuck cards on Home and their companion pages. Reachy SHALL be an optional Home card; the existing MicroDuck placement identifier and saved Home layouts SHALL remain valid. Each card SHALL keep its illustration mounted while accessible tabs flip only the controls, retain its dimensions across tabs for unchanged content, support reduced motion and remain readable at phone widths. Detailed source evidence and existing companion tools SHALL remain available on the owning pages.

#### Scenario: Place and navigate companion cards
- **WHEN** the operator adds Reachy or MicroDuck through Edit Home and opens their companion pages
- **THEN** the same card design and controls appear without enabling companions or changing existing placements

#### Scenario: Flip controls without moving artwork
- **WHEN** the user switches tabs with a pointer or keyboard on a desktop or phone
- **THEN** only the control face changes, artwork stays mounted, card dimensions remain stable for unchanged content, and reduced motion disables the flip

#### Scenario: Preserve Reachy controls and provenance
- **WHEN** the operator views Latest or changes text, category or social-snooze settings
- **THEN** latest versus saved history remains distinguishable and guarded existing commands report their actual outcomes while detailed provenance, fixtures and coding suggestions remain accessible

#### Scenario: Preserve explicit browser speech lifetime
- **WHEN** a qualified endpoint is explicitly enabled and the user switches card tabs
- **THEN** the same endpoint remains mounted, Stop and Mute retain their distinct effects, and navigation, removal or loss of current state cannot silently enable or replay speech

#### Scenario: Select one stored conversation
- **WHEN** the operator opens Conversation, chooses an eligible stored Reachy–MicroDuck exchange and confirms, cancels or clears the selection
- **THEN** only the existing selection pointer changes on confirmation or clear, history remains retained, and Meaning shows exactly the latest permitted Duck meaning with its original time and provenance

#### Scenario: Current access and state are required
- **WHEN** read/control permission is absent, the connection or copied state is stale, replacement sync begins or a delayed private read becomes obsolete
- **THEN** private Duck content is hidden, affected controls are unavailable, and no stale read restores content or sends a command

#### Scenario: Reads have no output effects
- **WHEN** the user opens either card, browses conversations, changes tabs, reloads or opens separate history
- **THEN** no text enablement, speech, model call, capture or robot action occurs and empty, emotional, unknown-meaning and unavailable states remain distinct
