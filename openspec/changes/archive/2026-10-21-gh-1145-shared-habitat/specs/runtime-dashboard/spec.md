## ADDED Requirements

### Requirement: Shared agent habitat

The dashboard SHALL offer a Habitat destination at `#/habitat`, showing one connected four-room habitat with ten resident slots over its existing session copy. Eligible observed sessions SHALL retain their resident while present; newest sessions SHALL fill free slots with deterministic ID ties; known children SHALL NOT occupy slots and unknown parentage SHALL NOT be guessed. Overflow SHALL be visible and SHALL NOT evict occupants. Confirmed membership removal SHALL free slots, while disconnected or resyncing evidence SHALL freeze residents without inferred departures. Empty residents SHALL be labelled unassigned and resting. The page SHALL preserve manual swaps, explicit demo mode, per-resident aprons, forty positions, furniture routing and hopping, and the shared dashboard state precedence.

#### Scenario: Ten residents, overflow and arrival
- **WHEN** twelve eligible sessions are observed, reordered and updated, then one assigned session is removed
- **THEN** ten stable distinct residents and two waiting sessions are shown, and only the freed slot admits the next waiting session

#### Scenario: Reconnect and remount
- **WHEN** the stream is lost during movement and the owner pauses motion, reconnects, leaves Habitat and returns
- **THEN** assigned residents freeze without releasing identity, authoritative membership reconciles after sync, local preferences restore, and leaving cancels the old renderer's animation and listeners

#### Scenario: Customization migration
- **WHEN** the owner explicitly imports a supported preview settings file or an invalid/oversized file
- **THEN** valid whitelisted preferences are backed up and applied locally without upload, while invalid input leaves existing preferences unchanged

#### Scenario: Deliberate conversation navigation
- **WHEN** the owner activates a qualified Codex Windows resident twice, or activates a demo/unassigned/unqualified resident
- **THEN** the first activation inspects and the second same-resident activation requests the exact existing conversation only when qualified, with no rapid-click requirement, command, unread acknowledgment or invented destination

#### Scenario: Safe presentation
- **WHEN** Habitat is opened at desktop or phone width, with reduced motion, hidden document or unavailable canvas
- **THEN** status remains readable, controls remain accessible without overflow, motion follows visibility/pause/reduced-motion, and rendering failure does not remove precise session information or crash the dashboard

## RENAMED Requirements

- FROM: `### Requirement: Four primary destinations with retained page addresses`
- TO: `### Requirement: Five primary destinations with retained page addresses`

## MODIFIED Requirements

### Requirement: Five primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Habitat, Rooms, Devices and Automation, in that order. Settings SHALL be a separate utility link reachable from every page. Home SHALL link Timeline. Nested brand, component, playback and declared module pages SHALL select Devices as their containing destination; Timeline SHALL select Home; Settings and Connections SHALL select the Settings utility. Existing Home aliases and brand, component, playback, module, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component or Music bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with Devices selected, and history restores the preceding address without replaying a command

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information
