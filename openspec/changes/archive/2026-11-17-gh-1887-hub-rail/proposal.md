## Why

The dashboard spends a rail, a separate top utility row and, on phones, a wrapping row of links on navigation. [Hub #1887](https://github.com/jimmie-potts/agent-device-hub/issues/1887) is the first story of the navigation epic ([#1886](https://github.com/jimmie-potts/agent-device-hub/issues/1886)): it puts everything in one rail so pages gain the top row's height and later stories have one place for pins and conversations.

## What changes

- Put Settings, the feed indicator and the session's control mode at the bottom of the rail, and remove the top utility row.
- Give each destination an icon and let the rail collapse to icons. It starts collapsed below 1200px and expanded from 1200px up, and the toggle's choice is kept in the browser for each of those two window sizes.
- Keep the rail in view while a page scrolls.
- On phones, replace the row of links with a drawer opened from a menu button.

## Capabilities

### Modified capabilities

- `runtime-dashboard`: where the Settings utility sits, and a new requirement for the collapsible rail and the phone drawer.

## Impact

The runtime dashboard shell, its stylesheet and its browser journeys change. Routes, page addresses, the module catalog, sign-in, the feed and every command owner stay the same. The collapse choice is a browser preference only.
