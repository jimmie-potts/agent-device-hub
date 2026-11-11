## ADDED Requirements

### Requirement: Home card shapes on one unit grid
At the wide layout, every Home card SHALL be one of four shapes built from one unit square: Small square (1×1), Wide (2 wide × 1 tall), Tall (1 wide × 2 tall) or Large square (2×2). Columns SHALL share the grid width equally and number as many as fit the owner-chosen minimum unit, and at least two; each row SHALL be one column tall. Cards SHALL be placed in saved order, each at the first free position where its shape fits, so a later card fills an earlier hole that it fits; cards SHALL have equal gaps and SHALL NOT be stretched to fill a hole. DOM and keyboard order SHALL equal saved order. Narrow screens and the Phone arrangement SHALL keep one column at content height with full card content.

#### Scenario: Mixed shapes tile
- **WHEN** the default layout or a saved layout mixing all four shapes is shown at the wide layout
- **THEN** every card's box is a whole number of units plus the gaps between them, no two cards overlap, gaps are equal and the only empty cells are ones no later card fits

#### Scenario: A two-wide card does not fit the rest of a row
- **WHEN** a Wide or Large square card follows cards that leave one free column in a row
- **THEN** it moves to the next position with two free columns and a later one-wide card fills the skipped cell when there is one

#### Scenario: Narrow screen
- **WHEN** Home is shown below the narrow breakpoint or in the Phone arrangement
- **THEN** cards stack in one column in saved order at their content height with full content

### Requirement: Shapes offered and chosen
Each Home card SHALL declare the shapes it offers and the shape a Standard placement shows. Edit Home SHALL let the owner choose a card's shape among those it offers, in place of Small, Standard and Wide, and the choice SHALL change only the draft until Done. A card without compact content SHALL offer only the shapes its full content fits.

#### Scenario: Change a shape and save
- **WHEN** the owner changes a card from Tall to Large square in Edit Home and chooses Done
- **THEN** the save sends no device command, and reload, another browser and runtime restart show the card as Large square

#### Scenario: Only offered shapes
- **WHEN** the owner opens the shape choice of the Inbox card
- **THEN** it offers Wide, Tall and Large square

### Requirement: Compact content for a shape
Every Home card SHALL offer only shapes whose content fits at the 220px unit, with nothing clipped, no scrolling inside the card and no stretched card. Hub mode, Inbox, Agent sessions, Timeline, light, room and Nanoleaf cards SHALL show their own compact content. A card without compact content of its own SHALL show a generic compact face with its name, current state and an Open link to the existing page that holds its full content and controls; Pixoo, Tidbyt and Wispr SHALL use it until their modules provide compact content. A control hidden by a shape SHALL be reachable one step away. Device-acting controls shown in a shape SHALL behave as in the full card. Art SHALL be cropped to its shape and the music visualizer SHALL fill its shape.

#### Scenario: Every offered shape fits
- **WHEN** each card is placed in each shape it offers at 1100, 1440 and 1920 px
- **THEN** its content height does not exceed the card, no control is cut off and the card has no scroll container

#### Scenario: Generic compact face
- **WHEN** a Pixoo card is a Small square on Home
- **THEN** it shows its name, its current state and Open, which leads to its existing device page with its full controls

#### Scenario: A light in one unit
- **WHEN** a light card is a Small square
- **THEN** it shows its name, state, artwork and On and Off controls, and its options menu leads to the rest of its controls

### Requirement: Width-only layouts convert to shapes
A placement saved without a shape SHALL show a stated shape for its saved width and card: Small shows Small square, else Tall; Standard shows the card's declared Standard shape; Wide shows Large square, else Wide; art shows the shape of its saved format. Loading SHALL keep widgets and order and SHALL NOT write the layout. The owner's next explicit save SHALL store a shape for every placement in both arrangements.

#### Scenario: An old-format layout loads
- **WHEN** Home loads a layout saved with Small, Standard and Wide only
- **THEN** each card shows its stated shape in the same order, and no layout command is sent

#### Scenario: The next save stores shapes
- **WHEN** the owner then chooses Done
- **THEN** every saved placement carries a shape and a width that agrees with it

### Requirement: Home layout record 2.2
The core SHALL publish `home-layout/2.2`, which adds an optional `shape` (`square`, `wide`, `tall`, `large-square`) to each placement and keeps the required `size`. The existing `home-layout-set/2.0` command SHALL accept the optional `shape`. The core SHALL keep a saved shape only while the placement's size agrees with it; when an incoming placement omits the shape and keeps its previous size, the core SHALL keep the previous shape. Older records SHALL remain valid without a store migration.

#### Scenario: An older dashboard changes a width
- **WHEN** an older dashboard saves a placement with a new size and the shape it copied unchanged
- **THEN** the core stores the new size without the shape, and the current dashboard converts the card from its new size

#### Scenario: An older client omits the shape
- **WHEN** a save keeps a placement's size but omits its shape
- **THEN** the core keeps the previous shape

## MODIFIED Requirements

### Requirement: Saved owner Home arrangements
The current runtime SHALL retain one versioned private desktop arrangement and one phone arrangement containing widget identities, sizes, shapes and hidden flags. Reads SHALL use existing owner sync and explicit saves SHALL use existing authenticated tracked commands with revision and expiry guards, without device effects or replay.

#### Scenario: Save and restart
- **WHEN** the owner adds a room card, changes shape and order, and chooses Done
- **THEN** another browser, reload and runtime restart show the saved arrangement, while adding appends the card to the other breakpoint if absent

#### Scenario: Refused or uncertain save
- **WHEN** a save is unauthorized, invalid, expired, conflicting, fails durable commit or loses its reply
- **THEN** the page preserves the appropriate refused or uncertain result, sends no device command, never automatically repeats the save and requires current evidence before another save

### Requirement: Layout editing
Home SHALL offer Edit Home, a source-aware card picker, the shapes each card offers, pointer and keyboard reorder, hide/remove, Cancel, Reset and Done. Editing SHALL disable device controls and SHALL show cards in their real grid placement. It SHALL preserve keyboard focus, desktop and phone layouts and the approved concise header.

#### Scenario: Draft changes and cancellation
- **WHEN** the owner rearranges cards, changes shapes, opens the picker, switches breakpoints and cancels
- **THEN** the saved arrangements remain unchanged and no command was sent

#### Scenario: Balanced visible rows
- **WHEN** the number of visible cards, their shapes or the available page width changes
- **THEN** cards tile on the unit grid in saved order with equal gaps and no stretched card, phone arrangements and their editor preview use one column
- **AND** art takes a shaped card or trailing empty cells without moving functional cards on image arrival

#### Scenario: Alert visibility without a notices section
- **WHEN** a hidden or removed Inbox or session placement has unresolved items or attention
- **THEN** its ordinary card stays visible until that evidence clears, with no separate notices section, Your space caption or layout caption

### Requirement: Bounded art placement preserves functional cards
Pinned art SHALL be a shaped Home card, cropped to its shape. Optional automatic art SHALL use only empty cells after the functional cards, in the largest shape it offers that fits, and SHALL be omitted when none fits, without changing functional card order or geometry. Automatic placement SHALL NOT overwrite saved arrangements. Changes to automatic geometry SHALL wait while a pointer interaction, focused control or Home edit is active. Attention cards SHALL remain visible and unobscured.

#### Scenario: Art arrives during interaction
- **WHEN** artwork finishes loading while a functional control has focus or a pointer interaction is active
- **THEN** its geometry and focus remain unchanged, visible attention remains accessible and no device command is sent

#### Scenario: A screen has no free space
- **WHEN** no empty cells after the functional cards fit an art shape
- **THEN** Home omits the optional art without overflow, overlap, saved-layout writes or functional-card movement

### Requirement: Paged Home list cards
Inbox, Agent status and Timeline SHALL page their lists through one shared component instead of growing, so a list never makes its card taller than its shape. The component SHALL show Previous and Next controls and a "Page x of y" label once a list needs a second page. On the unit grid, rows per page SHALL come from the card's shape at the minimum unit; off the grid they SHALL be Inbox 5, Timeline 5 on Home and 20 on its dedicated page, and Agent status two rows of tiles at the card's current column count. Agent status SHALL list sessions that need the owner first, in record order otherwise; when those sessions fill more than one page, the page label SHALL say so. Paging SHALL run in the browser over records the dashboard already holds and SHALL send no request or command. The Inbox SHALL show its total count on every page, and the Hub mode card's Check Inbox SHALL show the page holding its item before opening it. In a shaped card an opened entry SHALL take the page, with the pager hidden until it closes; elsewhere entries SHALL open in place with the pager shown. Removing the only entry on the last page SHALL show the previous page. When focus is inside the list at a page change or when its entry is removed or hidden, focus SHALL land on a control inside the list, never on the document body. Focus that has left the list SHALL NOT be moved or scrolled back when an entry is later removed. Saved Home arrangements SHALL keep their widgets and order.

#### Scenario: Page an Inbox of 13 items
- **WHEN** the Inbox holds 13 items in a Tall card
- **THEN** it shows the rows its shape holds, the total count and "Page 1 of y" with Previous disabled, the page and pager fit the card, and Next and Previous page by keyboard with focus on a pager control

#### Scenario: Open an item on a later page
- **WHEN** the owner opens an Inbox item on page 2 in a shaped card
- **THEN** the item takes the page with Send again and Dismiss reachable by keyboard inside the card, and closing it shows page 2 again

#### Scenario: Dismiss the last item on a page
- **WHEN** the owner dismisses the only item on the last page
- **THEN** the previous page is shown and focus is on a control inside the Inbox

#### Scenario: Check Inbox lands on the item's page
- **WHEN** the Inbox shows another page and the owner chooses Check Inbox on the Hub mode card
- **THEN** the page holding the related item is shown, and the item is open and focused

#### Scenario: Focus that left the list stays put
- **WHEN** the owner moves focus from an Inbox row to a control outside the list and that row is then removed elsewhere
- **THEN** focus stays on that control and the page does not scroll

#### Scenario: A session that needs the owner is on the first page
- **WHEN** the last session in record order starts waiting for approval
- **THEN** it appears on the first page of Agent status; with more waiting sessions than one page holds, the page label says how many need the owner

#### Scenario: Agent status and Timeline use the same pager
- **WHEN** Agent status or Timeline holds more entries than one page
- **THEN** the shared pager shows other entries on the next page and returns, with no request sent
