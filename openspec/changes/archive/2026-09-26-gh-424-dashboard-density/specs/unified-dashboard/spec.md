## MODIFIED Requirements

### Requirement: Home widget grid
The home SHALL be a grid of widgets drawn from a catalog. Each catalog entry SHALL declare an ID, a name, a description, its supported sizes, its source kind (a registered controller alias, a hub route or a read-only external source), the reads it needs and whether it offers command actions; a read-only widget has none. The home SHALL show one component widget per registered component with its health, mode, power, brightness and the everyday mode and power actions, rendered by the same controls as the component page and sharing their lifecycle state with it, and a link to that page. Observed sessions SHALL start alongside compact component controls in independent columns. Attention SHALL expand when present and collapse to one line when absent. Collector health SHALL use a named indicator with optional diagnostics. The wall and pixel component widgets SHALL start within the first screen at 1,440 px wide. Placement on the home is fixed in this version.

#### Scenario: Whole installation on the first screen
- **WHEN** the owner opens the home at 1,440 px wide with the wall and pixel components registered
- **THEN** each component widget and the sessions widget begin within the viewport, and the widgets reach across the width of the main column

#### Scenario: Quick action from the home
- **WHEN** the owner changes the mode or presses a power button on a component widget
- **THEN** one guarded command is sent with the same guards, wording and lifecycle as the component page's control, a running command or an uncertain lock on either instance is the same on the other, and one explicit reload unlocks both

## ADDED Requirements

### Requirement: Optional accessible supporting details
The dashboard SHALL keep session names, project/provider, activity, attention and stale evidence visible. Secondary session facts and label editing SHALL be available through an expandable Details panel. Supporting status information SHALL be available on mouse hover and keyboard focus, dismissible with Escape, and reachable by touch. Indicators SHALL include text rather than relying on color alone. Brightness meters SHALL represent only known values, never agent completion estimates. Inspection SHALL send no device commands.

#### Scenario: Compact session inspection
- **WHEN** the owner opens a titled session
- **THEN** its name, project/provider and named activity indicator are visible, while parent/child evidence and label editing remain available under Details

#### Scenario: Equivalent input access
- **WHEN** the owner hovers or focuses a status indicator, presses Escape, or opens Details on a touch viewport
- **THEN** supporting information appears and dismisses as requested, and inspection sends no device command

#### Scenario: Visible problems
- **WHEN** connection evidence is stale or a session requires attention
- **THEN** the warning remains visible without opening a tooltip or disclosure
