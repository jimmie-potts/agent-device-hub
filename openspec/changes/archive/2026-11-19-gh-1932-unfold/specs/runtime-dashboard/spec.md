## ADDED Requirements

### Requirement: Unfold a light in place on Home

On Home's unit grid, a light, room or group ring dial in the Small square shape SHALL have an arrow at its top left that unfolds the card in place to Large square, placed with the existing first-fit packing, showing the dial, its name and state, a link to the card's own page, its options and the controls of a two-row light card: power and brightness with the saved mode, color, scenes and the timer. The cards whose boxes change SHALL ease from where they were to where they are over 720 ms with the reference's small overshoot, and with reduced motion SHALL move at once. One card SHALL be open at a time: opening another closes the first. The arrow or Escape SHALL close the open card. Opening SHALL move focus into the opened controls, and closing by the arrow or by Escape from inside the card SHALL return focus to the arrow. Opening and closing SHALL send no command, request or save and SHALL NOT change the saved Home layout or any card's saved shape; the open card SHALL live only in the page's memory, so a reload shows none open. Entering Edit Home, a narrow screen or the Phone arrangement SHALL close the open card; there the full light cards are shown as before. The opened card's content SHALL fit its box with nothing scrolled, and Home SHALL NOT scroll sideways at any width with a card open. Without WebGL 2 the arrow and the opened controls SHALL work on the Quiet glass panels.

#### Scenario: Open and close by pointer, touch and keyboard
- **WHEN** the operator opens a light by clicking, tapping or pressing Enter on its arrow, then closes it with the arrow or Escape
- **THEN** the card becomes Large square with its controls and focus on its first control tab, then returns to Small square with focus on its arrow, and no command is sent

#### Scenario: One at a time
- **WHEN** a light is open and the operator opens another
- **THEN** the second opens and the first closes

#### Scenario: Never saved
- **WHEN** the operator reloads Home with a light open, or enters Edit Home
- **THEN** no light is open, every card shows its saved shape and the saved Home layout is unchanged

#### Scenario: Every width
- **WHEN** a light is open at 1440 or 1024 px, and the window then narrows to 390 or 320 px
- **THEN** the page has no sideways scroll; at the narrow widths the cards stack with their full content and the light is no longer open

### Requirement: Liquid glass while panels move

On Home's glass layer a panel whose box moves or changes size while a panel eases (such as when a light unfolds and its neighbors make room) SHALL turn liquid by how fast it changes, reaching full at 9 CSS pixels per frame at 60 frames a second: its corners SHALL round toward a capsule by up to 60%, its edge SHALL be displaced by noise up to 17 pixels either way, and its join to neighbors SHALL widen to 2.3 times. The state SHALL rise half the remaining gap per frame and settle by `exp(-3.4 s)`, both on a time base, and the layer SHALL draw no frame once every panel has settled. While a panel element is animating, the layer SHALL follow its box every frame. Scrolling, something added above the page, a window resize, a box that changes at once (a card's content growing, a move in Edit Home) and reduced motion SHALL NOT turn a panel liquid; a window resize and a box that changes at once SHALL each still draw one frame.

#### Scenario: A light unfolds
- **WHEN** a light opens and its neighbors move to make room
- **THEN** the opened panel and the panels that move turn liquid while they move, settle in about a second, and then the layer draws nothing

#### Scenario: Window resize and reduced motion
- **WHEN** the window is resized with a light open, or a light opens with reduced motion
- **THEN** no panel turns liquid and the glass follows each card's new box
