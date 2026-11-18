## ADDED Requirements

### Requirement: Jump palette that opens any page

The shell SHALL offer a jump palette that lists, in this order, up to three pages visited most recently in the open page session, the hub's destinations with Timeline, Settings and Connections, and every page the device directory lists for a module the current catalog reports as running. The current page SHALL NOT be listed as recent, each address SHALL be listed once outside the recent group, and a module that is not running or an address the catalog does not declare SHALL NOT be offered. Recent pages SHALL be held in memory only.

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
