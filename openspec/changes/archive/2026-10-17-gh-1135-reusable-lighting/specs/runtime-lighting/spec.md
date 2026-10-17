## Purpose

Let one operator reuse lighting controls and artwork across Home, brand and room views while retaining device ownership, private saved composition and truthful operation evidence.

## ADDED Requirements

### Requirement: Reusable glass lighting cards

The runtime dashboard SHALL use one lighting card implementation for individual lights, custom groups and room controls on Home and lighting brand/room views. Artwork SHALL remain mounted outside the animated control area across Power, Color, Scenes and Timer tabs. Tab changes SHALL send no command, preserve card height and support keyboard navigation, rapid selection and reduced motion. The glass treatment SHALL use the application token layer without changing fixed attention meanings or the existing shell's other surfaces. A placeholder SHALL be identified in Details rather than represented as live artwork.

#### Scenario: One light across views
- **WHEN** a light appears on Home and its brand page and the operator switches control tabs
- **THEN** both views use the same card and current owner records, the artwork stays in place, and no device command is sent

#### Scenario: Accessible control faces
- **WHEN** the operator uses the keyboard, quickly selects another tab, or enables reduced motion at desktop and phone widths
- **THEN** the final selected panel remains usable, only that panel exposes controls, reduced motion removes rotation, and controls fit without overflow or accessibility violations

### Requirement: Declared capabilities and shared command admission

Lighting controls SHALL use current declared device capabilities, existing authenticated actions and per-device request/outcome guards. A shared control SHALL preflight all members before sending and SHALL send at most one explicit command per member, reporting their independent outcomes without promising atomic application. Missing, stale, unavailable, externally controlled, held or uncertain members SHALL prevent ordinary shared writes. Requested, accepted, transmitted and observed evidence SHALL remain distinguishable. Native content SHALL retain explicit mode restrictions. Unsupported services SHALL have a reason rather than fabricated scene or timer behavior. The LIFX module's qualified model boundary SHALL remain unchanged.

#### Scenario: A group contains an unavailable or uncertain light
- **WHEN** one member lacks current usable evidence or has an unresolved operation
- **THEN** the shared action sends nothing, identifies the limitation, and reachable individual lights remain accessible from their brand view

#### Scenario: Actual controls and unavailable services
- **WHEN** a qualified LIFX light exposes color/temperature or a native scene is declared
- **THEN** the matching control sends its guarded native request, mode restrictions remain enforced, and a missing scene/timer service stays unavailable with a reason

#### Scenario: An interrupted action is revisited
- **WHEN** a reply is lost and the operator changes page, reloads or refreshes state
- **THEN** the uncertain operation remains visible and locked until definitive evidence permits release, and nothing resends the request

### Requirement: Private saved lighting composition

The runtime SHALL own one private, revisioned lighting layout containing bounded rooms, room assignments, Home selections and custom groups scoped to Home or one brand. Creating or changing a layout SHALL use authenticated control authority and a guarded save. The same layout SHALL survive browser reload, a second browser and runtime restart. Room names and assignments SHALL remain private; defaults SHALL invent no actual room membership. Failed saves SHALL leave prior committed state intact. Uncertain saves SHALL be reconciled against current core state without replay or an optimistic overwrite. The general widget-grid editor remains separate.

#### Scenario: Rooms follow assignments across clients
- **WHEN** the operator creates a room, assigns lights and selects that room for Home, then another browser opens it and the runtime restarts
- **THEN** the saved composition remains, the room card resolves current assignments, and an empty room stays manageable with disabled light controls

#### Scenario: Two clients save the same revision
- **WHEN** one layout save commits before another save using its old revision
- **THEN** the second is refused as a revision conflict without overwriting the first or sending a device command

### Requirement: Grouping changes placement only

The operator SHALL be able to group cards by drag or an explicit keyboard-accessible menu action, with brand groups restricted to the brand's devices. A custom group SHALL replace its individual controls in that view, while ungrouping restores individual cards without changing requested settings. Other view layouts SHALL remain independent. Room selections SHALL reference room identity rather than copied member arrays. Removing a room card SHALL preserve its room and assignments. Existing attention and inbox surfaces SHALL remain accessible.

#### Scenario: A custom group is created and removed
- **WHEN** the operator groups lights, navigates to another brand view and later ungroups them
- **THEN** only the selected view's placement changes, member settings remain current, and no layout operation sends a light command

#### Scenario: A room card is removed
- **WHEN** the operator removes a room selection from Home
- **THEN** its room and assignments remain available on the Rooms page and no light setting changes
