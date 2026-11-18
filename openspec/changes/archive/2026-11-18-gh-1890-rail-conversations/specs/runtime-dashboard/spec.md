## MODIFIED Requirements

### Requirement: One rail that collapses and becomes a phone drawer

The shell SHALL present the destinations, the Settings utility, the feed indicator and the session's control mode in one rail that stays in view while a page scrolls; a window too short to hold the rail SHALL let it scroll with the page, with its parts kept together at the top of the page. In the full rail and the phone drawer Settings and the feed indicator SHALL share one row at the bottom of the rail, and in the icon rail the indicator SHALL sit under Settings. In the rail the indicator SHALL be an icon that keeps its accessible name and whose details name the feed's condition. The skip link SHALL be visible above the rail whenever it has focus. A destination chosen from a navigation link SHALL open at the top of its page; the shell SHALL NOT set the scroll position on back or forward navigation. From 1200px wide the rail SHALL start expanded; below that it SHALL start as an icon rail in which every destination keeps its accessible name and shows that name on hover or keyboard focus. A toggle SHALL switch between the two, and the choice SHALL be kept in the browser separately for the two window sizes. Unavailable or damaged browser storage SHALL leave the defaults and a toggle that still works for the open page. At phone width the rail SHALL be a drawer opened from a menu button. Collapsing, expanding, opening and closing SHALL send no command, sync or provider request.

#### Scenario: Default and remembered rail
- **WHEN** the operator opens the dashboard in a wide window and in a narrower one, toggles the rail in one of them and reloads
- **THEN** the wide window starts with the full rail and the narrower one with the icon rail, the toggled size keeps the operator's choice after the reload, and the other size keeps its own

#### Scenario: Navigate while scrolled
- **WHEN** the operator scrolls a long page and chooses a destination in the rail
- **THEN** the rail is still in view to choose from, and the chosen page opens at its top

#### Scenario: Icon rail
- **WHEN** the rail is collapsed and the operator points at or focuses a destination
- **THEN** the destination's name appears beside its icon, its accessible name is the destination name once, and Settings and the feed indicator remain reachable at the bottom of the rail

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu button at phone width
- **THEN** the destinations and Settings appear in a drawer over the page with focus inside it
- **AND** the page behind it cannot be reached with the keyboard or the pointer
- **AND** choosing a destination, pressing Escape or tapping outside closes it and returns focus to the menu button

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the rail choice
- **THEN** the defaults apply, the toggle still changes the rail for the open page, and nothing fails

#### Scenario: Ended session
- **WHEN** the browser session has ended while the rail would be collapsed
- **THEN** the full rail is shown so that the sign-in recovery action is readable
- **AND** at phone width the recovery action is shown beside the menu button without opening the drawer, and inside the drawer while it is open

### Requirement: Pinned pages in the rail

A device page, a lighting-brand page, the Audio page and a declared module page SHALL offer a toggle in the page header that pins the page to the rail and unpins it. The Conversation page and the hub's own destinations SHALL NOT offer one. The rail SHALL list the pinned pages under the destinations in the order they were pinned, each as a link named for the page and, where the page is one of several of a module, for the module too. A pinned row SHALL offer an unpin button when the row is pointed at or the button has keyboard focus. The page that is open, when it can be pinned and is not, SHALL be a temporary row with a pin button that is always shown. A row for a page whose module is not running SHALL show that module's state in its text and in its name. After a row's own button is used, focus SHALL stay in the rail: on that row's button when the row is still there, and otherwise on the row before it or on the Devices row.

Pins SHALL be kept in the browser only. They SHALL survive a reload and SHALL follow a change made in another tab of the same browser. Unavailable or damaged browser storage SHALL leave pins working for the open page. A pin whose page the current catalog and device records do not declare SHALL NOT be shown and SHALL stay saved.

The pinned list SHALL scroll inside the rail when it is longer than the room above the rail's bottom group, which SHALL stay in view. The rail SHALL always have room for the list's heading and one row, and a window too short for that SHALL let the rail scroll with the page. With nothing to list, the rail SHALL show the list's heading alone, with no line of explanation under it, and SHALL keep the room for one row. In the icon rail a pinned page SHALL be shown as a short mark whose link keeps the page's name. Pinning, unpinning and opening a pinned page SHALL send no command, sync, upload or provider request.

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

#### Scenario: A pinned page's module is not running
- **WHEN** the catalog the page holds reports the module of a pinned page as stopped, failed or refused
- **THEN** the row stays and shows that state, and the page it opens says that it is unavailable

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the pins
- **THEN** the page starts with no pins, pinning and unpinning still work for the open page, and nothing fails

#### Scenario: Long list
- **WHEN** more pages are pinned than fit above the rail's bottom group
- **THEN** the list scrolls inside the rail and Settings and the feed indicator stay in view

#### Scenario: Nothing pinned
- **WHEN** nothing is pinned and the open page cannot be pinned
- **THEN** the rail shows the Pinned heading with nothing under it
- **AND** opening a page that shows a temporary row does not change whether the rail stays in view

#### Scenario: Conversation page
- **WHEN** the operator opens the Conversation page
- **THEN** its header has no pin toggle and the rail shows no temporary row for it

## ADDED Requirements

### Requirement: Conversations in the rail

While the current catalog declares the Conversation page of a running companions module, the rail SHALL list the chat profiles in its bottom group, above Settings, on every page: B.U.N.N.Y., Reachy and MicroDuck, with Reachy and MicroDuck labelled Demo. Each SHALL be a link that opens the Conversation page showing that profile with that profile's own history. The open conversation's row SHALL be marked as the current page, and on the Conversation page the Devices row SHALL be marked without a box, so that the rail boxes one row. Without that declaration the rail SHALL show no conversation group.

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
