## MODIFIED Requirements

### Requirement: Home widget grid
The home SHALL be a grid of widgets drawn from a catalog. Each catalog entry SHALL declare an ID, a name, a description, its supported sizes, its source kind (a registered controller alias, a hub route or a read-only external source), the reads it needs and whether it offers command actions; a read-only widget has none. The home SHALL show one component widget per registered component with its health, mode, power, brightness and the everyday mode and power actions, rendered by the same controls as the component page and sharing their lifecycle state with it, and a link to that page. Observed sessions SHALL start alongside compact component controls in independent columns. Attention SHALL expand when present and collapse to one line when absent. Collector health SHALL use a named indicator with optional diagnostics. At 2,133 × 1,200, 1,440 × 900 and 1,280 × 720 with six registered components, every component widget SHALL be fully visible within the first screen. Placement on the home is fixed in this version.

#### Scenario: Whole installation on the first screen
- **WHEN** the owner opens the home at 2,133 × 1,200, 1,440 × 900 or 1,280 × 720 with six components registered, including a wall and pixel with mode and power controls
- **THEN** all six component widgets are fully visible within the viewport, the sessions widget begins alongside them, and the widgets reach across the width of the main column

#### Scenario: Quick action from the home
- **WHEN** the owner changes the mode or presses a power button on a component widget
- **THEN** one guarded command is sent with the same guards, wording and lifecycle as the component page's control, a running command or an uncertain lock on either instance is the same on the other, and one explicit reload unlocks both
