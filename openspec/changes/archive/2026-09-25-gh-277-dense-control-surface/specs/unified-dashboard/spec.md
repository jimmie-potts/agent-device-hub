## ADDED Requirements

### Requirement: Page addresses
Every built-in page and every registered component SHALL have a hash address, and the browser's back and forward buttons SHALL walk between them. Built-in pages and registered components SHALL be distinct navigation kinds, so a component alias equal to a built-in page name opens only that component and the built-in page stays reachable. An address that names no page or no registered component SHALL show that nothing is there with a way home. Opening an address SHALL send no command.

#### Scenario: Alias named like a built-in page
- **WHEN** components with the aliases `activity` and `connections` are registered and the user opens each of them and each built-in page
- **THEN** exactly one navigation item is current, only the chosen page or component is shown, and the address distinguishes `#/component/connections` from `#/connections`

#### Scenario: Back button
- **WHEN** the user opens a component page and then presses the browser's back button
- **THEN** the previous page is shown again and nothing is sent

#### Scenario: Unknown address
- **WHEN** the address names a component that is not registered
- **THEN** the page says no such component exists and links to the home

### Requirement: Home widget grid
The home SHALL be a grid of widgets drawn from a catalog. Each catalog entry SHALL declare an ID, a name, a description, its supported sizes, its source kind (a registered controller alias, a hub route or a read-only external source), the reads it needs and whether it offers command actions; a read-only widget has none. The home SHALL show one component widget per registered component with its health, mode, power, brightness and the everyday mode and power actions, rendered by the same controls as the component page, and a link to that page. Attention, collector health and the observed sessions SHALL be widgets in the same grid, and every component widget SHALL start within the first screen at 1,440 px wide. Placement on the home is fixed in this version.

#### Scenario: Whole installation on the first screen
- **WHEN** the owner opens the home at 1,440 px wide with the wall and pixel components registered
- **THEN** each component widget and the sessions widget begin within the viewport, and the widgets reach across the width of the main column

#### Scenario: Quick action from the home
- **WHEN** the owner applies a mode or power change from a component widget
- **THEN** one guarded command is sent with the same guards, wording and lifecycle as the component page's control

### Requirement: Dense component page
A component page SHALL show a one-line status strip with mode, power, brightness, observation age and pending commands, keep its remaining facts behind a Details disclosure, and render every available control as a card in a grid that fills the width. Each card SHALL keep one short visible line, and longer guidance SHALL sit behind a disclosure. Nanoleaf's integration settings and mappings SHALL sit in one Assignments panel and the Pixoo view form in one Monitor panel. At 1,280 px wide the wall page SHALL be under 2,000 px tall. Every control's accessible name, explicit apply action, status sentences, availability reasons and lifecycle states MUST be unchanged by the layout.

#### Scenario: Wall page height
- **WHEN** the wall component page is opened at 1,280 px wide
- **THEN** its full height is under 2,000 px and its controls reach across the main column

#### Scenario: Rare facts on request
- **WHEN** the user opens the Details disclosure
- **THEN** the desired state, pending changes, last transmission, last outcome, external control, fetch age and integration outcomes are shown

#### Scenario: Unchanged control behavior
- **WHEN** the existing browser, matrix, retirement and local-controllers checks run against the dense layout
- **THEN** every command, gating, conflict, uncertain, focus, keyboard, reduced-motion and accessibility check passes with the same status sentences

### Requirement: Skin-owned scale
The application skin SHALL define the spacing and type scale as tokens alongside its color roles, and the layout SHALL read only tokens, so a skin changes values while the layout keeps its semantics.

#### Scenario: Token boundary
- **WHEN** the dashboard's authored styles are checked
- **THEN** no color literal appears outside the skin file and every token the layout reads is defined by the skin
