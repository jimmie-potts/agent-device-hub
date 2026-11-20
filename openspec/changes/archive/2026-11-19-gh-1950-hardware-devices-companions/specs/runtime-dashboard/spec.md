## MODIFIED Requirements

### Requirement: Five primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Companions, Rooms, Devices and Automation, in that order. Home, Companions, Rooms and Automation SHALL be links. Devices SHALL be a button that opens the Devices menu, and the menu's "All devices" entry SHALL be the link to the Devices directory at its existing address. Settings SHALL be a separate utility link reachable from every page, placed below the destinations at the bottom of the rail. Home SHALL link Timeline and Audio. Nested brand and component pages and the declared pages of hardware modules SHALL select Devices as their containing destination; Timeline, Audio, the full-window visualizer, the Music source pages and the declared pages of a module that is neither hardware nor companions SHALL select Home, and such a module page SHALL name Home as its parent; Habitat and the companions module's declared pages SHALL select Companions; Settings and Connections SHALL select the Settings utility. Existing Home aliases and Habitat, brand, component, playback, module, Audio, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component, Audio, Music or Habitat bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with its containing destination selected, and history restores the preceding address without replaying a command

#### Scenario: A page outside the hardware inventory
- **WHEN** the operator opens the Art Gallery or another page of a module that is not hardware, from Home, the jump palette, a pin or a bookmark
- **THEN** Home is selected in the rail and named as the page's parent, and Devices is not

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

#### Scenario: Open the directory
- **WHEN** the operator opens the Devices menu and chooses "All devices"
- **THEN** the Devices directory opens at its existing address with Devices selected

### Requirement: Devices directory derives from the current catalog

Devices SHALL list the configured hardware only, in Displays, Lighting and Appliances sections: each module that serves or holds device records, or is a known hardware module, as one card. A lighting brand's card SHALL lead to the brand's overview page and list each of its lights directly under it, each opening that light's existing device page. Any other hardware module SHALL be one card that opens its device's page, or list its devices when it has several, or open its first declared page when it holds no device records. Task pages, such as a display's media or a wall's saved shows, SHALL be reached from the device's own page and SHALL NOT be listed. Companion features, Audio and other pages that are not hardware SHALL NOT be listed. It SHALL derive destinations from existing catalog and record evidence and expose catalog failure, missing or stale observations, unavailable devices or refused modules honestly. It SHALL NOT create capabilities or device observations, independently acquire state or mutate any device during browsing. Existing Home widgets, saved room/Home placements and card adapters SHALL retain their behavior.

#### Scenario: Browse existing devices and feature pages
- **WHEN** the operator opens Devices and selects a destination in a category's section
- **THEN** the corresponding existing card or declared module page opens in the shared shell with its current observations and capability guards, without adding another main-navigation link

#### Scenario: Catalog or control authority is unavailable
- **WHEN** the catalog cannot be read, a module is refused, or a view is stale or read-only
- **THEN** the shell reports the available evidence without inventing destinations or enabling unsupported commands, and passive navigation makes no command attempt

#### Scenario: A retained uncertain attempt crosses navigation
- **WHEN** the operator leaves and returns to a card with an uncertain attempt
- **THEN** the card retains its existing lock and explicit refresh behavior and sends no replay

### Requirement: Shared agent habitat

The dashboard SHALL offer Habitat at `#/habitat`, under the Companions destination, showing one connected four-room habitat with ten resident slots over its existing session copy. Eligible observed sessions SHALL retain their resident while present; newest sessions SHALL fill free slots with deterministic ID ties; known children SHALL NOT occupy slots and unknown parentage SHALL NOT be guessed. Overflow SHALL be visible and SHALL NOT evict occupants. Confirmed membership removal SHALL free slots, while disconnected or resyncing evidence SHALL freeze residents without inferred departures. Empty residents SHALL be labelled unassigned and resting. The page SHALL preserve manual swaps, explicit demo mode, per-resident aprons, forty positions, furniture routing and hopping, and the shared dashboard state precedence.

#### Scenario: Ten residents, overflow and arrival
- **WHEN** twelve eligible sessions are observed, reordered and updated, then one assigned session is removed
- **THEN** ten stable distinct residents and two waiting sessions are shown, and only the freed slot admits the next waiting session

#### Scenario: Reconnect and remount
- **WHEN** the stream is lost during movement and the owner pauses motion, reconnects, leaves Habitat and returns
- **THEN** assigned residents freeze without releasing identity, authoritative membership reconciles after sync, local preferences restore, and leaving cancels the old renderer's animation and listeners

#### Scenario: Customization migration
- **WHEN** the owner explicitly imports a supported preview settings file or an invalid/oversized file
- **THEN** valid whitelisted preferences are backed up and applied locally without upload, while invalid input leaves existing preferences unchanged

#### Scenario: Deliberate conversation navigation
- **WHEN** the owner activates a qualified Codex Windows resident twice, or activates a demo/unassigned/unqualified resident
- **THEN** the first activation inspects and the second same-resident activation requests the exact existing conversation only when qualified, with no rapid-click requirement, command, unread acknowledgment or invented destination

#### Scenario: Safe presentation
- **WHEN** Habitat is opened at desktop or phone width, with hidden document or unavailable canvas
- **THEN** status remains readable, controls remain accessible without overflow, motion follows visibility/pause, and rendering failure does not remove precise session information or crash the dashboard

### Requirement: Jump palette that opens any page

The shell SHALL offer a jump palette that lists, in this order, up to three pages visited most recently in the open page session, the hub's destinations with Timeline, Audio, Habitat, Settings and Connections, every hardware page a module the current catalog reports as running declares, including each device's own page, and then every other page such a module declares, so that pages outside the hardware inventory stay reachable. The current page SHALL NOT be listed as recent, each address SHALL be listed once outside the recent group, and a module that is not running or an address the catalog does not declare SHALL NOT be offered. Recent pages SHALL be held in memory only.

Command and K, or Control and K, SHALL open the palette from anywhere on the page and close it when it is open, except that on a Mac Control and K pressed in a text field SHALL keep its text-editing meaning. A slash SHALL open the palette only when it is pressed outside a text field and outside an open menu, list or dialog; a control that takes no typed text, such as a slider or a checkbox, SHALL NOT count as a text field. The rail SHALL hold a field that opens the palette, shown as an icon in the icon rail, and the phone bar SHALL hold a button that opens it. While a modal dialog is open or an element is shown full screen, the palette's keys SHALL do nothing.

While the palette is open the page and the rail behind it SHALL be inert, and the palette SHALL be drawn above everything the page draws, including the full-window visualizer. The palette SHALL read its keys wherever focus is, and a press on a part of it that is not a row SHALL leave focus in its field. Typing SHALL narrow the list to the entries whose name or hint contains every typed word, with a name that starts with the query first. The chosen row SHALL be marked by a boundary with at least 3:1 contrast against the palette and against the row. The arrow keys SHALL move the choice, bring it into view and wrap at the ends; a list scrolled by touch or wheel SHALL otherwise stay where it was put, and Enter or a click SHALL open the chosen page at its top with focus on the page. An Enter still held from opening the palette SHALL NOT choose a row. Escape, the opening key again or a click outside SHALL close the palette and return focus to the element that had it; when it was opened from the phone drawer, focus SHALL return to the menu button. A page change made with the browser's back or forward while the palette is open SHALL close it. The palette SHALL fit a 320px window without horizontal overflow.

The palette SHALL only navigate. Opening it, typing, moving the choice and closing it SHALL send no command, sync, upload or provider request.

#### Scenario: Open from the keyboard
- **WHEN** the operator presses Command and K, Control and K outside a text field, or a slash outside a text field
- **THEN** the palette opens with focus in its field, listing recent pages, hub destinations and device pages
- **AND** the page and the rail behind it cannot be reached with the keyboard or the pointer

#### Scenario: A slash in a text field
- **WHEN** the operator types a slash in the Conversation composer or another text field
- **THEN** the slash is entered as text and the palette stays closed

#### Scenario: Narrow and open
- **WHEN** the operator types part of a page's name, moves the choice with the arrow keys and presses Enter
- **THEN** the list holds only matching pages with the best name match first
- **AND** the chosen page opens at its top with focus on the page, although the page left was scrolled

#### Scenario: Close and return
- **WHEN** the operator opens the palette from the Conversation composer with a draft in it and presses Escape
- **THEN** the palette closes, focus is in the composer again and the draft is unchanged

#### Scenario: Catalog change
- **WHEN** the catalog the page holds reports a module as stopped
- **THEN** that module's pages are not offered and the other pages still are

#### Scenario: Phone
- **WHEN** the operator taps the search button in the phone bar, or the field in the open drawer, at phone width
- **THEN** the palette opens within the window with no horizontal overflow
- **AND** closing it returns focus to the search button, or to the menu button when it was opened from the drawer

#### Scenario: Modal dialog open
- **WHEN** Conversation Details is open as a modal dialog and the operator presses Command and K or a slash
- **THEN** the palette stays closed and the dialog stays open

#### Scenario: Scroll the list
- **WHEN** the operator scrolls the list by touch or wheel and the shell renders again
- **THEN** the list stays where it was put
- **AND** the next arrow key brings the choice into view

#### Scenario: Focus leaves the field
- **WHEN** the operator presses on a group heading or the footer of the palette, or focus is outside the field for another reason
- **THEN** the arrow keys, Enter and Escape still act on the palette, typed text goes to the field and nothing behind the palette reacts

#### Scenario: Over the full-window visualizer
- **WHEN** the operator opens the palette on the full-window visualizer
- **THEN** the palette is drawn above the visualizer, and Escape closes the palette and leaves the visualizer open
- **AND** while an element is shown full screen the palette's keys do nothing

#### Scenario: Back while open
- **WHEN** the palette is open and the operator goes back in the browser's history
- **THEN** the preceding page is shown, the palette is closed and the page can be used

#### Scenario: Passive palette
- **WHEN** the operator opens the palette, moves the choice, types and closes it
- **THEN** no command, sync, upload or provider request is sent

### Requirement: Devices menu that opens every device page

The Devices row SHALL open a menu that lists the hardware the Devices directory lists for a module the current catalog reports as running, grouped under Displays, Lighting and Appliances with each address once, and an "All devices" entry that opens the directory. Pixoo and Tidbyt SHALL each be one entry. Each lighting brand SHALL be a disclosure, collapsed when the menu opens, that expands to an entry for each of its lights and an entry for the brand's overview; the brand that holds the open page SHALL start expanded. A module with several devices SHALL be a heading over them, and a module with one destination SHALL be that destination under the module's name. A module that is not running SHALL be named with its state and SHALL offer no page, and a running module whose observations are stale SHALL be marked stale. The menu SHALL mark the pinned pages and the page that is open.

The menu SHALL have a head with its own close button, SHALL open beside the rail level with the Devices row and inside the window, in the full rail and in the icon rail, and its lists SHALL scroll when the window is shorter than its content while "All devices" stays in view at its foot, with every brand expanded. It SHALL open with focus on the open page's entry, or on its first entry when the open page is not in it. The arrow keys SHALL move through the entries that are shown, skipping a collapsed brand's lights, and wrap at the ends; Enter, Space and the right arrow SHALL expand a brand, and the left arrow SHALL collapse the brand from its disclosure or one of its lights; Home and End SHALL move to the first and the last entry, and the focused entry SHALL have a visible indicator. With focus on no entry, the down arrow SHALL start at the first entry and the up arrow at the last. Escape SHALL close the menu with focus on the Devices row, and so SHALL a press on the row. A press outside the menu, a chosen page, the jump palette's opening key and focus moving out of the menu SHALL each close it, and a press or a focus move inside a framed module page SHALL count as outside. A page change or a change of layout that removes the menu while it holds focus SHALL move focus to the Devices row, or at phone width to the menu button. A chosen page SHALL open at its top with focus on the page. In the icon rail the Devices row SHALL keep its accessible name while the menu is open.

At phone width the menu SHALL cover the drawer as one scrolling column with its own close button, which SHALL leave the drawer open. Escape SHALL close the menu before the drawer. A chosen page SHALL close the menu and the drawer and return focus to the menu button.

The menu SHALL only navigate. Opening it, expanding and collapsing its brands, moving through it and closing it SHALL send no command, sync, upload or provider request.

#### Scenario: Open and move with the keyboard
- **WHEN** the operator presses Enter on the Devices row and then the arrow keys, Home and End
- **THEN** the menu opens beside the rail with focus on an entry, and focus moves through the shown entries, skipping collapsed lights, and wraps at the ends
- **AND** Escape closes the menu with focus on the Devices row

#### Scenario: Choose a page
- **WHEN** the operator chooses a page in the menu
- **THEN** the menu closes and the page opens at its top with focus on the page and Devices selected

#### Scenario: Close without choosing
- **WHEN** the operator presses outside the open menu, presses inside a framed module page, presses the Devices row again or moves focus out of the menu with Tab
- **THEN** the menu closes and no page is opened

#### Scenario: The page changes under the menu
- **WHEN** the operator uses the browser's back button while the menu is open with focus in it
- **THEN** the menu closes and focus is on the Devices row

#### Scenario: A module is not running
- **WHEN** the catalog the page holds reports a module as stopped, failed or refused
- **THEN** the menu names the module with that state and offers none of its pages, and the other modules' pages are still offered

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu from the drawer at phone width and uses the menu's close button
- **THEN** the menu had covered the drawer as one scrolling column, and closing it leaves the drawer open with focus on the Devices row

#### Scenario: Expand a lighting brand
- **WHEN** the operator expands Nanoleaf and LIFX in the menu and chooses a light
- **THEN** Nanoleaf lists its Lines and Panels and LIFX its distinct fixtures, each with the brand's overview, the light's existing device page opens, and the menu opens again with that light's brand expanded and the other brand collapsed

### Requirement: Conversations in the rail

While the current catalog declares the Conversation page of a running companions module, the rail SHALL list the chat profiles in its bottom group, above Settings, on every page: B.U.N.N.Y., Reachy and MicroDuck, with Reachy and MicroDuck labelled Demo. Each SHALL be a link that opens the Conversation page showing that profile with that profile's own history. The open conversation's row SHALL be marked as the current page, and on the Conversation page the Companions row SHALL be marked without a box, so that the rail boxes one row. Without that declaration the rail SHALL show no conversation group.

The group SHALL be the companions frontend's own component, which the shell mounts in its own module scope through the module's public frontend entry; the shell SHALL read no other part of that module's conversation. Choosing a profile SHALL send no command and SHALL register no speech endpoint. Choosing one while the Conversation page is open SHALL keep that page mounted, with each profile's draft.

A row SHALL carry a marker, and the words "Needs your answer" in its name, while that profile's task waits on a clarification or an approval that has no answer. A task that waits on the coding worker SHALL carry none. The marker SHALL be absent whenever the group's copy of the assistant state is missing, failed, removed, restarted or unavailable, and until the kind of the pending question has been read. The group SHALL learn the kind from one bounded read of that profile's recent history for a pending question, or from the open Conversation page when the page has read it. A read that fails SHALL NOT be repeated on a timer. It SHALL be made again when the state copy next changes or is live again, or when the open Conversation page stops showing that profile. At phone width the menu button SHALL carry the marker when a conversation other than the open one needs the owner.

In the icon rail a conversation SHALL be a tile whose name, Demo label and need appear beside it on hover or keyboard focus. In the phone drawer a row SHALL be a full touch target, and choosing one SHALL close the drawer and return focus to the menu button.

#### Scenario: Open a conversation from another page
- **WHEN** the operator is on Home, Rooms or a device page and chooses a profile in the rail
- **THEN** the Conversation page opens showing that profile with its own history, and its row is marked as the current page

#### Scenario: Change profile on the Conversation page
- **WHEN** the Conversation page is open with a draft and the operator chooses another profile in the rail and then the first one again
- **THEN** each profile shows its own history and draft, the first draft is still there, and no command, sync or speech endpoint registration is sent

#### Scenario: A conversation needs the owner
- **WHEN** a profile's task waits on a clarification or an approval
- **THEN** its row carries the marker on every page, and at phone width the menu button carries it unless that conversation is the open one

#### Scenario: Delegated work
- **WHEN** a profile's task waits on the coding worker
- **THEN** its row carries no marker

#### Scenario: State is not live or the kind is not known
- **WHEN** the assistant state copy is missing, failed, removed, restarted or unavailable, or the read of the pending question fails
- **THEN** no marker is shown, the rows stay links, and the failed read is not repeated on a timer

#### Scenario: A failed read is made again
- **WHEN** the read of a pending question has failed and the state copy changes or is live again, or the open Conversation page moves to another profile
- **THEN** the group reads that question once more, and marks the row when the question needs the owner

#### Scenario: Companions is not available
- **WHEN** the catalog reports the companions module as not running, or does not declare its Conversation page
- **THEN** the rail shows no conversation group and the menu button no marker

## ADDED Requirements

### Requirement: Companions destination with an overview

The Companions destination SHALL open an overview at `#/companions` that links Habitat and, while the current catalog reports a running companions module, each companion profile page, Preferences and Companion knowledge that the module declares. The Conversation page SHALL NOT be listed there; its conversations stay in the rail. Without a running companions module the overview SHALL offer Habitat alone and say why. Habitat and the companions module's pages SHALL show Companions as their parent above the page. The overview SHALL only navigate and SHALL send no command, sync, upload or provider request.

#### Scenario: Open companion features
- **WHEN** the operator chooses Companions in the rail and then one of its links
- **THEN** the overview lists Habitat, the companion profiles, Preferences and Companion knowledge, and the chosen page opens at its existing address with Companions selected

#### Scenario: An old Habitat bookmark
- **WHEN** the operator opens `#/habitat`
- **THEN** Habitat opens with Companions selected in the rail and named as its parent

#### Scenario: Companions is not running
- **WHEN** the catalog reports the companions module as stopped, or the catalog cannot be read
- **THEN** the overview offers Habitat and says why the companion features are unavailable

### Requirement: Display pages as one device with views

Tidbyt SHALL open its existing Status and Content card as one view with no page tabs. Pixoo SHALL open its device page as Display, for current playback and screen controls, with tabs for Display, Media and Agent status: Media SHALL hold Library and Playlists, and Agent status SHALL be the Monitor. Display SHALL link Advanced playback, which is the Player page, and Device settings, which is the Settings page; a linked page that is open SHALL be shown as a tab of its own. The Pixoo pages SHALL be titled with the display's name. Every existing Pixoo and Tidbyt address SHALL remain valid and open its view. A page a display declares that no view names SHALL stay reachable as a tab of its own. The views SHALL change navigation only: each module keeps its data, its reads and its guarded commands.

#### Scenario: Reach Monitor features and Device settings
- **WHEN** the operator opens Pixoo from the Devices menu and chooses Device settings, then Agent status, then Media and Playlists
- **THEN** the Settings, Monitor and Playlists pages open at their existing addresses with their view marked, and nothing is sent until the operator uses a control

#### Scenario: Old display bookmarks
- **WHEN** the operator opens `#/module/pixoo/player`, `#/module/pixoo/monitor` or `#/module/tidbyt/display`
- **THEN** the page opens with Advanced playback, Agent status or the Tidbyt card shown

### Requirement: Readable device names in navigation

The Devices menu, the directory, the jump palette, the pins and a device page's heading SHALL name a device by the label its device record publishes. Without one, a Nanoleaf controller SHALL be named Lines or Panels from the kind its module observes, and any other device SHALL be named by its stable ID read as words. Two devices of one module that would share a name SHALL be told apart by their IDs. A module with one device, other than a light, SHALL be named by the module in the menu, the palette and the pins. Names SHALL change presentation only: routes, pins and commands SHALL keep the stable IDs.

#### Scenario: Lights without published names
- **WHEN** the Nanoleaf records publish no labels and the LIFX records publish none
- **THEN** the Nanoleaf lights are named Lines and Panels and each LIFX fixture by its ID read as words, and each opens its existing device page

### Requirement: Devices, Companions and display pages on the shared glass layer

The Devices directory, the Companions overview and the Pixoo and Tidbyt pages SHALL draw on the shared glass layer over the Quiet glass wash, with no artwork backdrop and no fusing of neighboring panels. Each directory card, each overview card, a display's device card and a display's module page SHALL be one glass panel, and text that sits on the wash outside a panel SHALL carry a veil. Text over the layer SHALL keep at least 4.5:1 contrast in light and dark appearance. The layer SHALL draw nothing at rest. Without WebGL 2 or after a lost context the pages SHALL show their Quiet glass panels with every control working. The Devices popout SHALL keep its own fill over the layer. Leaving these pages SHALL release the layer.

#### Scenario: Glass at rest
- **WHEN** the operator opens the Devices directory, the Companions overview or a Pixoo or Tidbyt page in light or dark appearance
- **THEN** each card has a glass panel that follows its box, the page's text keeps 4.5:1, and the layer draws no frame while nothing changes

#### Scenario: No WebGL 2 or a lost context
- **WHEN** the browser has no WebGL 2, or the layer's context is lost
- **THEN** the pages show their Quiet glass panels, and the Devices menu, the directory's cards, the display tabs and the Companions links still work and send no command
