## ADDED Requirements

### Requirement: Read-only card

The module SHALL ship one reusable card with tabs Now, Timeline, Sessions, Totals and Gaps and no module page, placed through the Home editor at small, standard and wide sizes and shown in the Devices directory, with its illustration and dimensions stable across tabs. Its only command SHALL be the session threshold through the shell's tracked command attempt. Opening, refreshing or switching tabs SHALL send no command, and switching tabs SHALL issue no read; its history reads SHALL follow a new revision at most every 30 s, with no timer read. It SHALL have no heater, pump, release or delete control and no field for consumption, dose or inhalation. Anything not current SHALL read as unknown, never off, a refused or malformed read SHALL read as unavailable, never as an empty history, and a duration SHALL be drawn only between two edges seen as they happened with nothing unobserved between them.

#### Scenario: Passive use
- **WHEN** the owner opens the card, reloads the page and moves through every tab
- **THEN** no command is sent, the card keeps its size, and no control can reach the device

#### Scenario: Threshold
- **WHEN** the owner previews a threshold and then saves it
- **THEN** the preview changes no setting and sends no command, the save is one tracked `volcano-session-gap` command, the sessions regroup, and no stored fact changes

#### Scenario: Incomplete evidence
- **WHEN** the feed is stale or unavailable, a read is refused, there is no history yet, or a session has an unobserved interval, a hidden end or a discontinuity
- **THEN** the card shows unknown or unavailable, no zero or off is implied, and no duration crosses the missing interval
