## MODIFIED Requirements

### Requirement: Five primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Habitat, Rooms, Devices and Automation, in that order. Settings SHALL be a separate utility link reachable from every page, placed below the destinations at the bottom of the rail. Home SHALL link Timeline. Nested brand, component, playback and declared module pages SHALL select Devices as their containing destination; Timeline SHALL select Home; Settings and Connections SHALL select the Settings utility. Existing Home aliases and brand, component, playback, module, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component or Music bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with Devices selected, and history restores the preceding address without replaying a command

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

## ADDED Requirements

### Requirement: One rail that collapses and becomes a phone drawer

The shell SHALL present the destinations, the Settings utility, the feed indicator and the session's control mode in one rail that stays in view while a page scrolls. From 1200px wide the rail SHALL start expanded; below that it SHALL start as an icon rail in which every destination keeps its accessible name and shows that name on hover or keyboard focus. A toggle SHALL switch between the two, and the choice SHALL be kept in the browser separately for the two window sizes. Unavailable or damaged browser storage SHALL leave the defaults and a toggle that still works for the open page. At phone width the rail SHALL be a drawer opened from a menu button. Collapsing, expanding, opening and closing SHALL send no command, sync or provider request.

#### Scenario: Default and remembered rail
- **WHEN** the operator opens the dashboard in a wide window and in a narrower one, toggles the rail in one of them and reloads
- **THEN** the wide window starts with the full rail and the narrower one with the icon rail, the toggled size keeps the operator's choice after the reload, and the other size keeps its own

#### Scenario: Icon rail
- **WHEN** the rail is collapsed and the operator points at or focuses a destination
- **THEN** the destination's name appears beside its icon, its accessible name is the destination name once, and Settings and the feed indicator remain reachable at the bottom of the rail

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu button at phone width
- **THEN** the destinations and Settings appear in a drawer over the page with focus inside it
- **AND** choosing a destination, pressing Escape or tapping outside closes it, and Escape and an outside tap return focus to the menu button

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the rail choice
- **THEN** the defaults apply, the toggle still changes the rail for the open page, and nothing fails

#### Scenario: Ended session
- **WHEN** the browser session has ended while the rail would be collapsed
- **THEN** the full rail is shown so that the sign-in recovery action is readable
