## MODIFIED Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub's `apps/dashboard` source remains retained for manual return until separately authorized retirement (#839). The dashboard SHALL keep its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, and the Places links accessible through Settings. The current runtime SHALL use the accepted Quiet glass skin, whose role and private tokens are the only colors its styles use, following light/dark browser appearance. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

#### Scenario: Routes and the shell
- **WHEN** a signed-in page opens Settings, follows the Connections link, goes back, and opens an address that names no page
- **THEN** each page has its hash address, back returns to the preceding page, the unknown address shows that nothing is there with a link home, and nothing is sent

#### Scenario: Accessible pages
- **WHEN** the home and new shell destinations are checked at desktop and 320/390px widths in light/dark appearance and with reduced motion
- **THEN** the changed pages have no WCAG 2.1 A or AA violations, text and controls fit without horizontal overflow, and keyboard focus remains visible

#### Scenario: Fixed attention colors
- **WHEN** a session needs approval or input, or reports a continuing question
- **THEN** approval/input dots and chips use the fixed blocked token, and the continuing question uses the separate question token

## ADDED Requirements

### Requirement: Four primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Rooms, Devices and Automation, in that order. Settings SHALL be a separate utility link reachable from every page. Home SHALL link Timeline. Nested brand, component, playback and declared module pages SHALL select Devices as their containing destination; Timeline SHALL select Home; Settings and Connections SHALL select the Settings utility. Existing Home aliases and brand, component, playback, module, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component or Music bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with Devices selected, and history restores the preceding address without replaying a command

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

### Requirement: Devices directory derives from the current catalog

Devices SHALL group available brand, display, Audio, component and declared module destinations within Lighting, Displays, Audio and Other sections. It SHALL derive destinations from existing catalog and record evidence, retain unrecognized modules in the generic group, and expose catalog failure, missing observations or refused modules honestly. It SHALL NOT create capabilities or device observations, independently acquire state or mutate any device during browsing. Existing Home widgets, saved room/Home placements and card adapters SHALL retain their behavior.

#### Scenario: Browse existing devices and feature pages
- **WHEN** the operator opens Devices and selects a category and destination
- **THEN** the corresponding existing card or declared module page opens in the shared shell with its current observations and capability guards, without adding another main-navigation link

#### Scenario: Catalog or control authority is unavailable
- **WHEN** the catalog cannot be read, a module is refused, or a view is stale or read-only
- **THEN** the shell reports the available evidence without inventing destinations or enabling unsupported commands, and passive navigation makes no command attempt

#### Scenario: A retained uncertain attempt crosses navigation
- **WHEN** the operator leaves and returns to a card with an uncertain attempt
- **THEN** the card retains its existing lock and explicit refresh behavior and sends no replay
