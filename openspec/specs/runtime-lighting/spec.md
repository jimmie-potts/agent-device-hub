# Runtime lighting

## Purpose

Let one operator reuse lighting controls and artwork across Home, brand and room views while retaining device ownership, private saved composition and truthful operation evidence.

## Requirements

### Requirement: Reusable glass lighting cards

The runtime dashboard SHALL use one lighting card implementation for individual lights, custom groups and room controls on Home and lighting brand/room views. Artwork SHALL remain mounted outside the animated control area across Power, Color, Scenes and Timer tabs. Tab changes SHALL send no command, preserve card height and support keyboard navigation and rapid selection. The glass treatment SHALL use the application token layer without changing fixed attention meanings or the existing shell's other surfaces. A placeholder SHALL be identified in Details rather than represented as live artwork.

#### Scenario: One light across views
- **WHEN** a light appears on Home and its brand page and the operator switches control tabs
- **THEN** both views use the same card and current owner records, the artwork stays in place, and no device command is sent

#### Scenario: Keyboard and rapid control faces
- **WHEN** the operator uses the keyboard or quickly selects another tab at desktop and phone widths
- **THEN** the final selected panel remains usable, only that panel exposes controls, and controls fit without overflow

### Requirement: Declared capabilities and shared command admission

Lighting controls SHALL use current declared device capabilities, existing authenticated actions and per-device request/outcome guards. A shared control SHALL preflight all members before sending and SHALL send at most one explicit command per member, reporting their independent outcomes without promising atomic application. Missing, stale, unavailable, externally controlled, held or uncertain members SHALL prevent ordinary shared writes. The one exception is a Home group's All on or All off and its member switches (see Fuse drag and group panel on Home), which send each member its own power command under that member's own guards. Requested, accepted, transmitted and observed evidence SHALL remain distinguishable. Native content SHALL retain explicit mode restrictions. Unsupported services SHALL have a reason rather than fabricated scene or timer behavior. The LIFX module's qualified model boundary SHALL remain unchanged.

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

The operator SHALL be able to group cards by drag or an explicit keyboard-accessible menu action, with brand groups restricted to the brand's devices. On Home a group MAY also hold Wemo plugs, grouped with lights, with a group or with other plugs; brand groups SHALL hold only lights. A custom group SHALL replace its individual controls in that view, while ungrouping restores individual cards without changing requested settings. Other view layouts SHALL remain independent. Room selections SHALL reference room identity rather than copied member arrays. Removing a room card SHALL preserve its room and assignments. Existing attention and inbox surfaces SHALL remain accessible. Grouping, ungrouping and renaming SHALL change placement only and send no device command; the one new behavior a group has is its All on or All off control. A lighting command SHALL never be sent to a plug member, and a card whose members are not all lights SHALL never send a shared lighting command.

#### Scenario: A custom group is created and removed
- **WHEN** the operator groups lights, navigates to another brand view and later ungroups them
- **THEN** only the selected view's placement changes, member settings remain current, and no layout operation sends a light command

#### Scenario: A room card is removed
- **WHEN** the operator removes a room selection from Home
- **THEN** its room and assignments remain available on the Rooms page and no light setting changes

#### Scenario: A group holds a plug
- **WHEN** the operator groups a light with a plug, or two plugs, on Home
- **THEN** the save sends no device command, the group lists both members, and a release that does not know plug members refuses the whole card and sends nothing to it

### Requirement: Ring dial in one unit

A light, room or group card with lights in the Small square Home shape SHALL be a ring dial: a ring that shows the observed brightness, the card's name, a state line and, for a light that follows the hub mode, its saved-mode line. Dragging the ring up or down SHALL dim and pressing it without a drag SHALL switch the light, by mouse, pen or touch; a drag on the ring SHALL NOT scroll the page. The ring SHALL be a slider for the keyboard (arrow keys, Page Up and Page Down, Home and End) and its center a switch (Enter or Space). A drag or a held key SHALL send nothing until it is released and then exactly one brightness command, and none when the value ends where it started; it SHALL start from the newest requested or observed brightness, an off light's stored brightness included. A press SHALL send one power command. These SHALL be the same guarded power and brightness commands the card's other shapes send, with the same capability, read-only, stale, in-flight, held and uncertain guards. The ring and the light the panel gives the glass layer SHALL follow observed state only. A value being dragged or keyed SHALL show apart from the observed value. When the latest power or brightness request of that kind succeeded after the light's last report, it SHALL show beside the observed state until the light reports it; a latest request that failed, was refused, expired, is uncertain or is still in flight, any other write, or a report since SHALL leave the observation in charge. The switch SHALL show the newest power so defined, and a press SHALL switch away from it. A refused or unanswered command SHALL NOT show as done. On Home the dial's top left SHALL hold the arrow that unfolds the card and its top right SHALL stay clear. Other shapes SHALL keep their current faces, and without WebGL 2 the dial SHALL show its state in plain CSS and work.

#### Scenario: Switch and dim by pointer, touch and keyboard
- **WHEN** the operator presses or taps the ring, drags it, or uses its slider and switch keys
- **THEN** each action sends one command identical in route, target, data fields and value kind to the current card's power or brightness command

#### Scenario: Observed state only
- **WHEN** a command is sent and the light has not reported its result
- **THEN** the ring, the switch and the glow keep the observed state, the state line shows the request beside it, and a refused, unanswered or uncertain result shows on the card without the dial showing it as done

#### Scenario: Read-only
- **WHEN** a read-only session opens Home
- **THEN** the dial shows the observed state and sends nothing on any press, drag or key

### Requirement: Arrangement notices inside a Home light card

On Home, a status about a light card's arrangement, such as lighting layout records that are unavailable or stale, SHALL show inside the card, below its state, and SHALL NOT sit on the backdrop above the card or move the card's face. A Small square dial SHALL show it on one line with the full text available; an unfolded or two-row card SHALL show the full text. Other lighting pages SHALL keep the notice above their cards.

#### Scenario: Stale layout records
- **WHEN** Home loses its stream while light dials are shown, one of them unfolded
- **THEN** each light card shows the stale layout notice inside it, no notice sits above the cards, and each dial stays where it was in its card

### Requirement: Fuse drag and group panel on Home

On Home each light, plug and group panel SHALL have a drag handle at its top right that starts a pointer drag by mouse, pen or touch; a drag on the handle SHALL NOT scroll the page and SHALL NOT dim. The dragged card SHALL follow the pointer, and the light, plug or group card under the pointer SHALL light up as the target; rooms and every other card SHALL NOT be targets. Dropping on a target SHALL group the two through the existing guarded lighting layout save; dropping anywhere else, Escape, a cancelled pointer or a lost pointer capture SHALL return the card and save nothing. Near the window's top or bottom edge a drag SHALL scroll the page. Grouping SHALL keep every other light card shown on Home, rooms included, in the lighting Home selection. A refused, expired, unanswered or failed save SHALL leave the members as they were and say "Not grouped" with the reason. The "Group with" selector in a card's options, a plug's included, SHALL stay the keyboard path and offer every other light, group and plug on Home; light and plug cards SHALL have the handle and the selector in every shape and in their full cards on a phone. A Home card's own refusals and every lighting save state that needs attention SHALL show on Home's one status line: a save in flight, a refused, expired or failed save, and an uncertain or conflicting one, the last three with Refresh records and without resending. A grouping's progress line SHALL go when its save succeeds and SHALL be replaced by its outcome otherwise. A card's note SHALL show only while it is newer than the latest save's state, and never over a save left uncertain or conflicting. This SHALL replace the light card's "Drag to group" on Home. A group SHALL show as a group panel in the Wide shape, and a group that holds a plug in every shape: its name, its member count, one All on or All off control, Ungroup and each member with its own switch. A member's switch SHALL show its power as the ring dial shows it: its observed power, or its latest power request when that succeeded after its last report, which its state line SHALL then show beside the observed power; a press SHALL switch away from that power. All on or All off SHALL send each member its own existing power command with that member's own guards (a light through its lighting power command, a plug through its Wemo power command); there SHALL be no group command. A member a guard blocks SHALL NOT be sent and SHALL say why, and the others SHALL still be sent. A member whose command was refused, was not sent, has not been answered or is uncertain SHALL be named with that result, and the panel SHALL NOT show the group as switched until its members report it. Read-only sessions SHALL see no handle and SHALL neither group, ungroup nor switch. Without WebGL 2 the drag, the target outline and the group panel SHALL work in Quiet glass.

#### Scenario: Drag to group by mouse and by touch
- **WHEN** the operator drags two lights, two plugs, or a light and a plug together by a handle with a mouse or a finger
- **THEN** the dragged card follows the pointer, the target lights up, the drop saves one group, and the group is there after a reload and in a second browser

#### Scenario: A drop elsewhere
- **WHEN** the operator drops a card away from any light, plug or group card, or on another kind of card
- **THEN** the card returns to its place and nothing is sent

#### Scenario: All off with a member that refuses and one that does not answer
- **WHEN** the operator presses All on or All off and one member's command is refused while another's gets no answer
- **THEN** every member was sent its own power command, the others switch, and the panel names the refused member and the one waiting for an answer

#### Scenario: Refused save
- **WHEN** the layout save for a drop or a "Group with" choice is refused
- **THEN** the members stay as they were, the saved layout is unchanged and Home says "Not grouped" with the refusal

#### Scenario: Read-only
- **WHEN** a read-only session opens Home with a group
- **THEN** no handle shows and All on or All off, Ungroup, the member switches and "Group with" are disabled
