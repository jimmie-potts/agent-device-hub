## Context

The shell already holds everything a page list needs: its own routes, and `directoryEntries`, the projection the Devices directory draws from the module catalog and the device copies. Story #1887 left room for a field in the rail.

## Decisions

- The list is a projection in `jump.ts`: the shell's destinations, then each link of each running directory entry, once per address. It reads nothing new. An entry whose module is not running is left out, so the palette never offers a page that would open as unavailable.
- Recent pages are kept in a ref for the page session. The shell records the page it leaves, and the palette shows up to three that the current catalog still offers, without the current page. They are not saved; recents that survive a reload are deferred on the issue.
- The key rules are one pure function, `jumpShortcut`, called from a `keydown` listener on the window. The listener ignores a key a component already handled. Command and K or Control and K toggles the palette anywhere. On a Mac, Control and K in a text field deletes to the end of the line, so it is left alone there; the Conversation composer is such a field. A slash opens the palette only outside a text field and outside an open menu, list or dialog.
- The palette is a `role="dialog"` element with the rest of the shell made inert, as the phone drawer does. While a modal `dialog` element is open (Conversation Details at phone width) the palette could only render underneath it and could not be reached, so its keys do nothing until that dialog closes.
- Closing returns focus to the element that had it. When the palette is opened from the phone drawer, the drawer closes underneath, so focus returns to the menu button.
- A page change the palette did not make, from the browser's back or forward, closes the palette. It was opened over the page that was left, and its recent list and focus target belong to that page.
- The palette and the navigation links share one `navigate` function, so a page chosen in the palette also opens at its top. Focus then moves to the page, as it does after the skip link.
- The filter keeps an entry when every typed word appears in its name, its hint or its group. A name that starts with the query ranks first, then a name that contains it, then matches in the hint or group. A query drops the Recent copies so a page is listed once.
- The key hint in the rail and the palette's footer of key names are hidden for a coarse pointer, where there is no hardware keyboard to use them.
- The brand's second line needs more width than the 44px toggle leaves in the 184px rail, and wrapped. The brand now starts at the column's edge and the head borrows 8px of the rail's padding, which is enough for one line clear of the toggle.

## Risks and tradeoffs

A key pressed inside a framed module page does not reach the shell, so the shortcuts do nothing while focus is in such a frame; the rail's field and the phone bar's button still open the palette. On a Mac, Control and K opens the palette outside text fields only, which differs from Command and K by design.
