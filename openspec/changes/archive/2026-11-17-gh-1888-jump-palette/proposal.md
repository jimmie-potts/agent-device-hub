## Why

Every page of the dashboard is reached by pointing at the rail and then at a page's own links. [Hub #1888](https://github.com/jimmie-potts/agent-device-hub/issues/1888), the second story of the navigation epic ([#1886](https://github.com/jimmie-potts/agent-device-hub/issues/1886)), lets the owner open any page from the keyboard. It delivers the page-jump part of [#288](https://github.com/jimmie-potts/agent-device-hub/issues/288).

## What changes

- Add a jump palette that lists the hub's destinations, every page the device directory lists for a running module, and the pages visited most recently in this page session.
- Open it with Command or Control and K, with a slash outside a text field, from a "Jump to…" field in the rail and from a search button in the phone bar.
- Narrow the list as the owner types, move with the arrow keys, open with Enter, and close with Escape with focus returned to where it was.
- Keep the brand's second line in the rail head on one line beside the collapse toggle.

## Capabilities

### Modified capabilities

- `runtime-dashboard`: a new requirement for the jump palette.

## Impact

The runtime dashboard shell, its stylesheet, its unit tests and two browser journeys change. Routes, page addresses, the module catalog, sign-in, the feed and every command owner stay the same. The palette reads what the shell already holds and only navigates.
