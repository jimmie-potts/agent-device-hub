## MODIFIED Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub's `apps/dashboard` source remains retained for manual return until separately authorized retirement (#839). The dashboard SHALL keep its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, and the Places links accessible through Settings. The current runtime SHALL use the accepted Quiet glass skin, whose role and private tokens are the only colors its styles use, following light/dark browser appearance. Bounded artwork-derived decorative values SHALL be supported over that skin under the owner's theme preference while fixed state meanings, readable contrast, typography and geometry remain unchanged. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

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

### Requirement: Owner-controlled art theme
Settings SHALL offer Follow artwork, Lock current colors and Restore default as browser-local presentation controls. A successful save SHALL preserve the chosen mode and locked palette or locked default across reload and restart. Restore default SHALL remain effective until an explicit later choice. Storage failure or invalid saved input SHALL leave a usable prior/default theme with truthful save status and no automatic write retry.

#### Scenario: Lock and restore
- **WHEN** the owner locks displayed colors and another artwork appears, then the browser or runtime restarts
- **THEN** the locked colors remain, and Restore default returns to Quiet glass without changing layout or spending provider allowance

#### Scenario: Lock the default
- **WHEN** no valid art theme is applied and the owner locks current colors
- **THEN** the default remains locked across artwork arrivals and restart without inventing a palette

#### Scenario: Contrast and fixed meanings
- **WHEN** contrasting art palettes are applied in light and dark appearance across ordinary, warning, error, pending, disabled and focused controls
- **THEN** only allowed decorative roles change, text and focus remain readable, semantic/device colors retain their meanings and control geometry stays fixed

#### Scenario: Browser storage fails
- **WHEN** saving an explicit preference fails or another tab supplies invalid preference data
- **THEN** the page keeps a valid theme and clearly reports that the attempted preference was not saved or could not be read
