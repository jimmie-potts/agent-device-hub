## ADDED Requirements

### Requirement: Saved owner Home arrangements
The current runtime SHALL retain one versioned private desktop arrangement and one phone arrangement containing widget identities, sizes and hidden flags. Reads SHALL use existing owner sync and explicit saves SHALL use existing authenticated tracked commands with revision and expiry guards, without device effects or replay.

#### Scenario: Save and restart
- **WHEN** the owner adds a room card, changes size and order, and chooses Done
- **THEN** another browser, reload and runtime restart show the saved arrangement, while adding appends the card to the other breakpoint if absent

#### Scenario: Refused or uncertain save
- **WHEN** a save is unauthorized, invalid, expired, conflicting, fails durable commit or loses its reply
- **THEN** the page preserves the appropriate refused or uncertain result, sends no device command, never automatically repeats the save and requires current evidence before another save

### Requirement: Accessible layout editing
Home SHALL offer Edit Home, a source-aware card picker, supported sizes, pointer and keyboard reorder, hide/remove, Cancel, Reset and Done. Editing SHALL disable device controls. It SHALL preserve keyboard focus, reduced motion, desktop and phone accessibility and the approved concise header.

#### Scenario: Draft changes and cancellation
- **WHEN** the owner rearranges cards, opens the picker, switches breakpoints and cancels
- **THEN** the saved arrangements remain unchanged and no command was sent

#### Scenario: Alert visibility without a notices section
- **WHEN** a hidden or removed Inbox or session placement has unresolved items or attention
- **THEN** its ordinary card stays visible until that evidence clears, with no separate notices section, Your space caption or layout caption

### Requirement: Current catalog and unavailable sources
The picker SHALL include the registered reusable core, device, light, room, music and exposed numeric cards, with supported sizes and availability reasons. A missing source instance SHALL remain unavailable. Unknown retired definitions SHALL be omitted and reported once per saved revision without rewriting the saved layout.

#### Scenario: Source loss and definition retirement
- **WHEN** a saved card's source becomes unavailable or its definition is removed
- **THEN** source loss preserves an unavailable card while an unknown definition is omitted with one report, and neither condition sends device commands or silently writes layout metadata
