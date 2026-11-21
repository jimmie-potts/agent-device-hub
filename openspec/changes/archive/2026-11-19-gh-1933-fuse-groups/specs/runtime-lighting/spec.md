## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Fuse drag and group panel on Home

On Home each light, plug and group panel SHALL have a drag handle at its top right that starts a pointer drag by mouse, pen or touch; a drag on the handle SHALL NOT scroll the page and SHALL NOT dim. The dragged card SHALL follow the pointer, and the light, plug or group card under the pointer SHALL light up as the target; rooms and every other card SHALL NOT be targets. Dropping on a target SHALL group the two through the existing guarded lighting layout save; dropping anywhere else, Escape or a cancelled pointer SHALL return the card and save nothing. A refused, expired, unanswered or failed save SHALL leave the members as they were and say "Not grouped" with the reason. The "Group with" selector in a card's options, a plug's included, SHALL stay the keyboard path and offer every other light, group and plug on Home. This SHALL replace the light card's "Drag to group" on Home. A group SHALL show as a group panel in the Wide shape, and a group that holds a plug in every shape: its name, its member count, one All on or All off control, Ungroup and each member with its own switch. A member's switch SHALL show its power as the ring dial shows it: its observed power, or its latest power request when that succeeded after its last report, which its state line SHALL then show beside the observed power; a press SHALL switch away from that power. All on or All off SHALL send each member its own existing power command with that member's own guards (a light through its lighting power command, a plug through its Wemo power command); there SHALL be no group command. A member a guard blocks SHALL NOT be sent and SHALL say why, and the others SHALL still be sent. A member whose command was refused, was not sent, has not been answered or is uncertain SHALL be named with that result, and the panel SHALL NOT show the group as switched until its members report it. Read-only sessions SHALL see no handle and SHALL neither group, ungroup nor switch. Without WebGL 2 the drag, the target outline and the group panel SHALL work in Quiet glass.

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
