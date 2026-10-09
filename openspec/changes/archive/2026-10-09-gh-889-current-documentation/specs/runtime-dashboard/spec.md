## MODIFIED Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve a copy of the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub's `apps/dashboard` source remains retained for manual return until separately authorized retirement (#839). The copy SHALL keep the shell, its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, the Places navigation and the Neon skin, whose role and private tokens are the only colors its styles use. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

#### Scenario: Routes and the shell
- **WHEN** a signed-in page follows the Connections link, goes back, and opens an address that names no page
- **THEN** each page has its hash address, the back button returns to the home, the unknown address shows that nothing is there with a link home, and nothing is sent

#### Scenario: Accessible pages
- **WHEN** the home is checked at 1,440 and 390 px, and the launcher's page on its own
- **THEN** axe finds no WCAG 2.1 A or AA violation, no text overlaps on the desktop home, and the phone width has no horizontal overflow

#### Scenario: Fixed attention colors
- **WHEN** a session needs approval or input, or reports a continuing question
- **THEN** approval/input dots and chips use the fixed blocked token, and the continuing question uses the separate question token
