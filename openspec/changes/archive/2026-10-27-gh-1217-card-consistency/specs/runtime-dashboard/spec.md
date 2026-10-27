## ADDED Requirements

### Requirement: Consistent reusable card presentation

The runtime dashboard SHALL give existing reusable cards a shared glass frame, responsive padding, card-title hierarchy, tab treatment and footer-link targets across Home and feature destinations. This includes lighting and room/group cards, displays, Music, Wemo, Hub mode, Inbox, Timeline, agent status, Wispr, ONN and Roborock; the optional MicroDuck card SHALL inherit the widget frame without activating a source. Device artwork, domain-specific control-face sizes, fixed tab geometry, attention colors and concise but truthful state wording SHALL remain intact. Styling SHALL NOT change source ownership, command admission, stored layout, collection or device behavior.

#### Scenario: Same card on Home and a feature page
- **WHEN** an existing card is viewed on Home and its brand, device, Audio or Room destination
- **THEN** its frame, title treatment and controls follow the same visual rules, while its artwork and domain-specific controls remain available

#### Scenario: Consistent tabs and corner controls
- **WHEN** the user changes an existing device card's tabs or focuses a corner status control
- **THEN** tabs have a consistent selected treatment and visible keyboard focus, actionable corner controls have clear touch targets, and changing a tab keeps its artwork and control-face geometry stable without sending a product command

#### Scenario: Phone and theme appearance
- **WHEN** the cards are viewed at desktop, 390px and 320px widths in light and dark appearance
- **THEN** padding follows one responsive rule, labels and controls fit without horizontal overflow, footer links have usable targets, and changed content passes applicable WCAG A/AA checks

#### Scenario: Attention and unavailable evidence
- **WHEN** an agent needs input, a source is stale or unavailable, or a control is disabled
- **THEN** the existing written states, fixed attention colors, disabled protections and access to evidence remain distinguishable; shared styling does not make missing evidence appear current or turn an observation into success

#### Scenario: Quiet idle command feedback
- **WHEN** a Music card is opened before any command from that card
- **THEN** its idle face omits routine no-command boilerplate, while later command progress, errors and results remain visible through the existing feedback region
