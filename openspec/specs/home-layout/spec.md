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

### Requirement: Standard Home card heights
At the wide layout, Home cards SHALL have one of two standard heights, defined once beside the width rule: long, the list size, and short, sized so two short cards stacked with the grid gap are exactly one long card. Each widget SHALL declare its height in the widget catalog: list cards are long, a card whose content fits the short height without clipping or scrolling is short, and every other card is long. Home SHALL pack saved cards into rows in saved order by their preferred widths, share each row's spare width and place two short cards stacked beside a long card without a hole; a short card left alone beside a long card SHALL fill both tracks. Document and keyboard order SHALL equal saved order; a short card MAY appear under an earlier short card in the same row, ahead of a long card saved before it, and only in that case. A card SHALL NOT clip its controls: when content exceeds its height, its tracks SHALL grow and the cards sharing them SHALL keep lining up. Only cards the widget catalog marks tall, the art card, MAY exceed the long height. Where cards stack in one column, each card SHALL be as tall as its content. Saved Home arrangements SHALL load with the same widgets, order and sizes.

#### Scenario: Rows line up at every size
- **WHEN** Home shows Inbox, Hub mode, Wispr, Agent status, Timeline and light cards at Small, Standard or Wide with an Inbox of 0, 1 or 13 items
- **THEN** a long card is two short heights plus the gap, short cards are the short height, Hub mode and Wispr stack beside the Inbox at Small and Standard, cards in the same track start and end together, and the visible card fills its slot

#### Scenario: Long device cards beside short cards
- **WHEN** a Pixoo card, Hub mode, Wispr and a light card share a row
- **THEN** the Pixoo and light cards take the long height and Hub mode and Wispr stack between them

#### Scenario: Media cards opt out in the catalog
- **WHEN** the widget catalog is read
- **THEN** Inbox, Agent status and Timeline are long, Hub mode and Wispr are short, and only the art card is marked tall

#### Scenario: Stacked cards keep content height
- **WHEN** Home is 375 px wide
- **THEN** cards are not held to a standard height and the page has no horizontal overflow

#### Scenario: A saved layout is unchanged
- **WHEN** an arrangement saved through the existing command loads
- **THEN** the saved record and the rendered Home keep its widgets, order and sizes

### Requirement: Paged Home list cards
Inbox, Agent status and Timeline SHALL page their lists through one shared component with Previous and Next controls and a "Page x of y" label, shown when a list needs a second page, instead of growing or scrolling inside the card. Rows per page SHALL fit the long height; Agent status SHALL page whole rows of tiles at the card's current column count. Paging SHALL run in the browser over records the dashboard already holds and SHALL send no request or command. The Inbox SHALL show its total count on every page. Opening an Inbox item or Timeline entry SHALL give it the whole page so its controls stay inside the card; an opened agent tile SHALL stay beside the other tiles on its page. Removing the only entry on the last page SHALL show the previous page. After a page change or a removed or hidden focused entry, focus SHALL land on a control inside the list, never on the document body. Narrow screens SHALL page the same way.

#### Scenario: Page an Inbox of 13 items
- **WHEN** the Inbox holds more items than one page
- **THEN** it shows the first page, the total count and a disabled Previous; Next shows the following items, keeps the total count and leaves focus on a pager control

#### Scenario: Expanded item stays inside the card
- **WHEN** the owner opens an Inbox item
- **THEN** only that item is shown, its Send again and Dismiss controls lie inside the card at the long height, and closing it restores the page

#### Scenario: Dismiss the last item on a page
- **WHEN** the owner dismisses the only item on the last page
- **THEN** the previous page is shown and focus is on a control inside the Inbox

#### Scenario: Agent status and Timeline use the same pager
- **WHEN** Agent status or Timeline holds more entries than one page
- **THEN** the shared pager shows other entries on the next page and returns, with focus on a pager control and no request sent
