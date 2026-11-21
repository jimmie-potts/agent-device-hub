## ADDED Requirements

### Requirement: Ring dial in one unit

A light, room or group card with lights in the Small square Home shape SHALL be a ring dial: a ring that shows the observed brightness, the card's name, a state line and, for a light that follows the hub mode, its saved-mode line. Dragging the ring up or down SHALL dim and pressing it without a drag SHALL switch the light, by mouse, pen or touch; a drag on the ring SHALL NOT scroll the page. The ring SHALL be a slider for the keyboard (arrow keys, Page Up and Page Down, Home and End) and its center a switch (Enter or Space). A drag or a held key SHALL send nothing until it is released and then exactly one brightness command, and none when the value ends where it started; it SHALL start from the newest requested or observed brightness, an off light's stored brightness included. A press SHALL send one power command. These SHALL be the same guarded power and brightness commands the card's other shapes send, with the same capability, read-only, stale, in-flight, held and uncertain guards. The ring and the light the panel gives the glass layer SHALL follow observed state only. A value being dragged or keyed SHALL show apart from the observed value. When the latest power or brightness request of that kind succeeded after the light's last report, it SHALL show beside the observed state until the light reports it; a latest request that failed, was refused, expired, is uncertain or is still in flight, any other write, or a report since SHALL leave the observation in charge. The switch SHALL show the newest power so defined, and a press SHALL switch away from it. A refused or unanswered command SHALL NOT show as done. The ring's top corners SHALL stay clear. Other shapes SHALL keep their current faces, and without WebGL 2 the dial SHALL show its state in plain CSS and work.

#### Scenario: Switch and dim by pointer, touch and keyboard
- **WHEN** the operator presses or taps the ring, drags it, or uses its slider and switch keys
- **THEN** each action sends one command identical in route, target, data fields and value kind to the current card's power or brightness command

#### Scenario: Observed state only
- **WHEN** a command is sent and the light has not reported its result
- **THEN** the ring, the switch and the glow keep the observed state, the state line shows the request beside it, and a refused, unanswered or uncertain result shows on the card without the dial showing it as done

#### Scenario: Read-only
- **WHEN** a read-only session opens Home
- **THEN** the dial shows the observed state and sends nothing on any press, drag or key
