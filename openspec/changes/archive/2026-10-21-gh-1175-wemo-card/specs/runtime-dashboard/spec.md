## ADDED Requirements

### Requirement: Reusable concise Wemo card
The dashboard SHALL reuse one Wemo presentation on Home and existing Wemo device routes. Its primary illustration SHALL represent the connected desk lamp with a smaller Wemo plug. Power and Auto-off tabs SHALL retain artwork position and card dimensions at desktop and phone widths. Switching tabs SHALL preserve drafts, send nothing and make inactive controls unavailable to keyboard and accessibility interaction; reduced-motion appearance SHALL remove the flip animation.

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
