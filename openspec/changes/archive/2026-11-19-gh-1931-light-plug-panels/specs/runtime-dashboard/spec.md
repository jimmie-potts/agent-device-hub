## ADDED Requirements

### Requirement: Plug press panel on Home

A Wemo plug in the Small square Home shape SHALL be a press panel: its name, a state line with its observed power or the limitation that blocks it (stale, unavailable, held, power unknown or read-only), and Open to its existing device page. When the plug's latest power request succeeded after its last report, it SHALL show beside the observed power until the plug reports it; a latest request that did not succeed SHALL leave the observation in charge. Pressing the panel by mouse, touch, Enter or Space SHALL send the existing guarded power command for the opposite of the newest power so defined, the same command the full card sends; the panel SHALL be disabled while that power is unknown or a guard blocks a change. Its pressed state SHALL follow that newest power and its light the plug's observed power, and a command result that needs attention SHALL show on the panel. The panel's top right SHALL stay clear.

#### Scenario: Press the plug
- **WHEN** the operator presses the panel by pointer, touch or keyboard
- **THEN** one power command identical to the full card's is sent, and the panel shows on or off when the plug reports it

#### Scenario: A lost reply
- **WHEN** a plug's power reply is lost
- **THEN** the panel shows the uncertain result, cannot be pressed, and nothing is sent again

### Requirement: Lights light Home's glass

On Home's glass layer a light or a plug that current records observe on SHALL light the room from its lamp (a dial's ring center, a plug's icon, or the artwork of a light card in another shape): its panel SHALL take up to half its color from the light, brightest near the lamp; the backdrop SHALL take its light thinning with the square of the distance, halved where another panel is in the way; and the bevels of panels facing the lamp SHALL catch it. A LIFX light's color SHALL be its observed `lifx-light` color; a light whose module reports no color, and a plug, SHALL glow in the skin's warm white. The level SHALL follow observed brightness (a plug 0.8), and a requested, stale or unknown state SHALL draw no light. A panel held down by the pointer SHALL brighten, widen its bevel and spill white light at half strength. Light and press SHALL ease at 16% and 24% of the remaining gap per frame at 60 frames a second on a time base, and the layer SHALL draw no frame once they settle. With every light off no light SHALL be drawn.

#### Scenario: Observed color and warm white
- **WHEN** a LIFX light observed red, a Nanoleaf light and a plug are on
- **THEN** the LIFX panel glows red from its ring's center and the backdrop above it takes red, while the Nanoleaf light and the plug glow warm white

#### Scenario: Every light off
- **WHEN** every light and plug on Home is observed off
- **THEN** the layer draws exactly what it draws for panels with no lamp, and draws no frame at rest

## MODIFIED Requirements

### Requirement: Reusable concise Wemo card
The dashboard SHALL reuse one Wemo presentation on Home in one column and existing Wemo device routes; on Home's unit grid a plug is the press panel. Its primary illustration SHALL represent the connected desk lamp with a smaller Wemo plug. Power and Auto-off tabs SHALL retain artwork position and card dimensions at desktop and phone widths. Switching tabs SHALL preserve drafts, send nothing and make inactive controls unavailable to keyboard interaction.

Routine controls SHALL omit repeated On/Off observation text, reported-by-plug wording, Smart plug, Armed and the standing warning below Save limit. The selected power button SHALL reflect plug-reported power rather than desired state or command acceptance. Missing observations SHALL not select Off. Stale, unavailable, held and uncertain evidence SHALL remain explicit. A collapsed device evidence disclosure SHALL retain observation age, desired versus observed state, enforcement/run/deadline/attempt evidence and the Hub/reachability limitation without adding a Details or Activity tab.

The card SHALL retain existing control/freshness/capability guards, per-target request identity, independent explicit limit saves, uncertain-operation recovery and no replay. Refresh and explicit hold release SHALL not send power. Weekly schedules SHALL remain in Automation. Illustrations SHALL not claim visible lamp output.

#### Scenario: Switch controls without moving the card
- **WHEN** a person switches Power and Auto-off at a supported desktop or phone width
- **THEN** the same card and artwork retain their geometry, drafts remain intact, only active controls are accessible and no device or settings mutation occurs

#### Scenario: Observe power while a request is pending
- **WHEN** a power command is requested or accepted before a fresh plug report confirms it
- **THEN** the selected button still follows the reported state and the pending or uncertain outcome remains distinct without an automatic retry

#### Scenario: Edit one limit and revisit the card
- **WHEN** a person explicitly saves one plug's duration or enabled state and changes tabs or routes
- **THEN** the existing authoritative limit save remains independent of other plugs and weekly schedules, with no new command on navigation

#### Scenario: Recover uncertain work
- **WHEN** a lost power or settings reply is followed by refresh, navigation or reload
- **THEN** unresolved power work keeps its existing gate, a limit save requires fresh current settings before another explicit attempt, refresh sends no power, and only an explicit qualified hold release clears the device hold without repeating its uncertain power write
