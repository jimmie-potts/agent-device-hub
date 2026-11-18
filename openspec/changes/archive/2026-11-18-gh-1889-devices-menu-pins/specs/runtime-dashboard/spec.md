## MODIFIED Requirements

### Requirement: Five primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Habitat, Rooms, Devices and Automation, in that order. Home, Habitat, Rooms and Automation SHALL be links. Devices SHALL be a button that opens the Devices menu, and the menu's "All devices" entry SHALL be the link to the Devices directory at its existing address. Settings SHALL be a separate utility link reachable from every page, placed below the destinations at the bottom of the rail. Home SHALL link Timeline. Nested brand, component, playback and declared module pages SHALL select Devices as their containing destination; Timeline SHALL select Home; Settings and Connections SHALL select the Settings utility. Existing Home aliases and brand, component, playback, module, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component or Music bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with Devices selected, and history restores the preceding address without replaying a command

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

#### Scenario: Open the directory
- **WHEN** the operator opens the Devices menu and chooses "All devices"
- **THEN** the Devices directory opens at its existing address with Devices selected

## ADDED Requirements

### Requirement: Devices menu that opens every device page

The Devices row SHALL open a menu that lists every page the Devices directory lists for a module the current catalog reports as running, grouped under Lighting, Displays, Audio and Other with each address once, and an "All devices" entry that opens the directory. A module with several pages SHALL be a heading over its pages, and a module with one page SHALL be that page under the module's name. A module that is not running SHALL be named with its state and SHALL offer no page, and a running module whose observations are stale SHALL be marked stale. The menu SHALL mark the pinned pages and the page that is open.

The menu SHALL open beside the rail and inside the window, in the full rail and in the icon rail, and SHALL scroll when the window is shorter than its content. It SHALL open with focus on the open page's entry, or on its first entry when the open page is not in it. The arrow keys SHALL move through the entries and wrap at the ends, Home and End SHALL move to the first and the last entry, and the focused entry SHALL have a visible indicator. Escape SHALL close the menu with focus on the Devices row. A press outside the menu, a press on the row, a chosen page, the jump palette's opening key and focus moving out of the menu SHALL each close it. A chosen page SHALL open at its top with focus on the page. In the icon rail the Devices row SHALL keep its accessible name while the menu is open.

At phone width the menu SHALL cover the drawer as one scrolling column with its own close button, which SHALL leave the drawer open. Escape SHALL close the menu before the drawer. A chosen page SHALL close the menu and the drawer and return focus to the menu button.

The menu SHALL only navigate. Opening it, moving through it and closing it SHALL send no command, sync, upload or provider request.

#### Scenario: Open and move with the keyboard
- **WHEN** the operator presses Enter on the Devices row and then the arrow keys, Home and End
- **THEN** the menu opens beside the rail with focus on an entry, and focus moves through the entries and wraps at the ends
- **AND** Escape closes the menu with focus on the Devices row

#### Scenario: Choose a page
- **WHEN** the operator chooses a page in the menu
- **THEN** the menu closes and the page opens at its top with focus on the page and Devices selected

#### Scenario: Close without choosing
- **WHEN** the operator presses outside the open menu, presses the Devices row again or moves focus out of the menu with Tab
- **THEN** the menu closes and no page is opened

#### Scenario: A module is not running
- **WHEN** the catalog the page holds reports a module as stopped, failed or refused
- **THEN** the menu names the module with that state and offers none of its pages, and the other modules' pages are still offered

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu from the drawer at phone width and uses the menu's close button
- **THEN** the menu had covered the drawer as one scrolling column, and closing it leaves the drawer open with focus on the Devices row

### Requirement: Pinned pages in the rail

A device page, a lighting-brand page, the Audio page and a declared module page SHALL offer a toggle in the page header that pins the page to the rail and unpins it. The Conversation page and the hub's own destinations SHALL NOT offer one. The rail SHALL list the pinned pages under the destinations in the order they were pinned, each as a link named for the page and, where the page is one of several of a module, for the module too. A pinned row SHALL offer an unpin button when the row is pointed at or the button has keyboard focus. The page that is open, when it can be pinned and is not, SHALL be a temporary row with a pin button that is always shown. After a row's own button is used, focus SHALL stay in the rail: on that row's button when the row is still there, and otherwise on the row before it or on the Devices row.

Pins SHALL be kept in the browser only. They SHALL survive a reload and SHALL follow a change made in another tab of the same browser. Unavailable or damaged browser storage SHALL leave pins working for the open page. A pin whose page the current catalog and device records do not declare SHALL NOT be shown and SHALL stay saved.

The pinned list SHALL scroll inside the rail when it is longer than the room above the rail's bottom group, which SHALL stay in view. The rail SHALL always have room for the list's heading and one row, and a window too short for that SHALL let the rail scroll with the page. In the icon rail a pinned page SHALL be shown as a short mark whose link keeps the page's name. Pinning, unpinning and opening a pinned page SHALL send no command, sync, upload or provider request.

#### Scenario: Pin from a page header
- **WHEN** the operator uses the toggle in a device page's header and then opens another page
- **THEN** the rail lists the pinned page, and its row opens the page at its top

#### Scenario: Unpin and reload
- **WHEN** the operator pins two pages, unpins one from its row and reloads
- **THEN** the remaining pin is listed after the reload and the unpinned page is not

#### Scenario: The open page is not pinned
- **WHEN** the operator opens a page that can be pinned and is not
- **THEN** the rail shows it as a temporary row whose button pins it, and leaving the page removes the row

#### Scenario: A page is no longer declared
- **WHEN** the catalog the page holds no longer declares a pinned page
- **THEN** its row is not shown, the other pins are, and the pin is listed again once the page is declared

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the pins
- **THEN** the page starts with no pins, pinning and unpinning still work for the open page, and nothing fails

#### Scenario: Long list
- **WHEN** more pages are pinned than fit above the rail's bottom group
- **THEN** the list scrolls inside the rail and Settings and the feed indicator stay in view

#### Scenario: Conversation page
- **WHEN** the operator opens the Conversation page
- **THEN** its header has no pin toggle and the rail shows no temporary row for it
