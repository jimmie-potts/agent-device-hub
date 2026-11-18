## Why

A device page is reached from the Devices directory: one click for the directory, one for its category and one for the page. [Hub #1889](https://github.com/jimmie-potts/agent-device-hub/issues/1889), the third story of the navigation epic ([#1886](https://github.com/jimmie-potts/agent-device-hub/issues/1886)), puts every device page two clicks away and the owner's usual pages one click away, as the owner's accepted **Pinned** prototype does.

## What changes

- The Devices row in the rail becomes a button that opens a menu of every page the Devices directory lists, grouped as the directory groups them. The menu's "All devices" opens the directory, which keeps its address.
- Device, lighting-brand, Audio and module pages get a "Pin to rail" toggle in their header. The Conversation page does not.
- The rail lists the pinned pages under the destinations. The page that is open and not pinned is a temporary row with a pin button.
- Pins are saved in this browser only.
- The shell measures whether the rail fits its window, instead of using one fixed height for a connected session and another for an ended one. The shell root's `data-session` attribute, which the ended session's rule used, is removed (finding R17 from the review of PR 1898).

## Capabilities

### Modified capabilities

- `runtime-dashboard`: the five-destinations requirement says what Devices is now, and two requirements are added, for the Devices menu and for pinned pages.

## Impact

The runtime dashboard shell, its stylesheet, the Audio and lighting-brand page headers, the dashboard's unit tests and its browser journeys change. Routes, page addresses, the module catalog, sign-in, the feed and every command owner stay the same. The menu and the pins read what the shell already holds; they navigate, or change a list in the browser, and nothing else.
