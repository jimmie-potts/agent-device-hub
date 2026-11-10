# home-layout Specification

## Purpose

Let the owner arrange existing reusable Home cards independently for desktop and phone, with private durable metadata and no device effects from layout editing.

## Requirements

### Requirement: Saved owner Home arrangements
The current runtime SHALL retain one versioned private desktop arrangement and one phone arrangement containing widget identities, sizes and hidden flags. Reads SHALL use existing owner sync and explicit saves SHALL use existing authenticated tracked commands with revision and expiry guards, without device effects or replay.

#### Scenario: Save and restart
- **WHEN** the owner adds a room card, changes size and order, and chooses Done
- **THEN** another browser, reload and runtime restart show the saved arrangement, while adding appends the card to the other breakpoint if absent

#### Scenario: Refused or uncertain save
- **WHEN** a save is unauthorized, invalid, expired, conflicting, fails durable commit or loses its reply
- **THEN** the page preserves the appropriate refused or uncertain result, sends no device command, never automatically repeats the save and requires current evidence before another save

### Requirement: Layout editing
Home SHALL offer Edit Home, a source-aware card picker, supported functional-card sizes and art shapes, pointer and keyboard reorder, hide/remove, Cancel, Reset and Done. Editing SHALL disable device controls. It SHALL preserve keyboard focus, desktop and phone layouts and the approved concise header.

#### Scenario: Draft changes and cancellation
- **WHEN** the owner rearranges cards, opens the picker, switches breakpoints and cancels
- **THEN** the saved arrangements remain unchanged and no command was sent

#### Scenario: Balanced visible rows
- **WHEN** the number of visible functional cards, their supported sizes or the available page width changes
- **THEN** functional cards wrap in saved order and share each row's available width without empty trailing slots, Small retains a compact width relative to Standard, Wide occupies a full row and phone arrangements and their editor preview use one column
- **AND** art uses its separate bounded reservation or automatic trailing placement without repacking functional cards on image arrival

#### Scenario: Alert visibility without a notices section
- **WHEN** a hidden or removed Inbox or session placement has unresolved items or attention
- **THEN** its ordinary card stays visible until that evidence clears, with no separate notices section, Your space caption or layout caption

### Requirement: Current catalog and unavailable sources
The picker SHALL include the registered reusable core, device, light, room, music, art and exposed numeric cards, with supported sizes or shapes and availability reasons. A missing source instance SHALL remain unavailable. Unknown retired definitions SHALL be omitted and reported once per saved revision without rewriting the saved layout.

#### Scenario: Source loss and definition retirement
- **WHEN** a saved card's source becomes unavailable or its definition is removed
- **THEN** source loss preserves an unavailable card while an unknown definition is omitted with one report, and neither condition sends device commands or silently writes layout metadata

### Requirement: Searchable neutral card picker
The Add card picker SHALL filter the current catalog locally by card name or
category, combined with its visually distinguishable selected category. Empty results SHALL offer a
concise message and a reset of both filters. Opening the picker SHALL focus its
labelled search field; closing SHALL return focus to Add card. Identifiers SHALL
use existing public artwork or neutral inline icons without mounting control
adapters, reading private media or acquiring another connection merely for a
picker preview. Icons SHALL add no keyboard stop or observed-state claim.
Existing sizes, availability reasons, added/hidden state, duplicate and capacity
guards, independent arrangements, attention protection and guarded Done/Cancel
behavior SHALL remain unchanged. Filtering and Add/Show SHALL send no command.

#### Scenario: Combine search and category
- **WHEN** the owner searches a card name or category, applies a category and resets an empty result
- **THEN** only matching current catalog rows appear, reset restores the full catalog and focus returns to search without changing the saved layout or sending a command

#### Scenario: Identify and add a card safely
- **WHEN** the owner browses identifiers and adds or shows an eligible card
- **THEN** unavailable rows retain their reasons, already visible cards cannot be duplicated, icons acquire no source or media, and only the draft changes until guarded Done succeeds

### Requirement: Bounded art placement preserves functional cards
Home SHALL offer banner, square and tall art presentation within bounded responsive geometry. An explicit owner placement SHALL reserve stable geometry independent of image arrival. Optional automatic art SHALL use only trailing free space and SHALL shrink or disappear when that space cannot fit it, without changing functional card order or geometry. Automatic placement SHALL NOT overwrite saved arrangements. Changes to automatic geometry SHALL wait while a pointer interaction, focused control or Home edit is active. Attention cards SHALL remain visible and unobscured.

#### Scenario: Art arrives during interaction
- **WHEN** artwork finishes loading while a functional control has focus or a pointer interaction is active
- **THEN** its geometry and focus remain unchanged, visible attention remains accessible and no device command is sent

#### Scenario: A screen has no free space
- **WHEN** the remaining screen area cannot fit optional automatic art
- **THEN** Home omits the optional art without overflow, overlap, saved-layout writes or functional-card movement

### Requirement: Explicit art layout controls persist with Home
Pin, dismiss, restore and format controls SHALL change only the core-owned Home arrangement through the existing revision-guarded save. Pin SHALL reserve the owner's selected art geometry. Layout dismissal SHALL remain distinct from negative art feedback and artwork deletion. Desktop and phone arrangements SHALL remain independent. Reset SHALL restore the default arrangement through the existing explicit edit flow. Existing arrangements without art metadata SHALL remain valid.

#### Scenario: Layout choices survive restart
- **WHEN** the owner pins or dismisses art and its save succeeds
- **THEN** reload, another browser and runtime restart show that saved choice, Restore remains available for dismissed art and no generation or device command occurred

#### Scenario: A layout save is uncertain or conflicting
- **WHEN** another browser changes the revision or a save loses its reply
- **THEN** the existing conflict or uncertainty controls preserve the owner's evidence, send no automatic retry and do not overwrite the other arrangement

#### Scenario: An older client omits optional art metadata
- **WHEN** a valid older save retains the art placement but omits its optional format and pin
- **THEN** the core preserves those existing options while applying unrelated placement changes
- **AND** explicit new options, removal and reset still take effect
