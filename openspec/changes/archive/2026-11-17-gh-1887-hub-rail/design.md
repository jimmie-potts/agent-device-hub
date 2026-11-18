## Context

The shell rendered the five destinations in an `aside`, the Settings link and the control mode in a `top` header inside `main`, and at phone width turned the destinations into a row above the page.

## Decisions

- Keep the existing landmarks: the `Main navigation` and `Utilities` navigation regions, `sidebar-foot` and the `Sign in again` button keep their names, so the journeys and the verification captures that use them keep working at desktop width.
- The collapse choice lives in `localStorage` under one key with a value per window size, read through a small store that follows the pattern of the visualizer effect choice. It is a browser preference, as the art theme is. No core or module state, and no server read or write.
- The stylesheet picks the default from the window width with media queries, and the shell publishes only an explicit choice as `data-rail-wide` and `data-rail-narrow`. The layout therefore never waits for a script after a resize; a journey that measured a card straight after one caught the earlier script-driven version in the wrong state for a frame. The icon-rail rules exist once per window size, and a unit test keeps the two copies the same.
- An icon-rail link keeps its label element and shows that same element beside the icon on hover or focus. Generated content would double the link's accessible name.
- The rail is sticky and as tall as the viewport, with visible overflow so the hover names and the feed details can open beside it. A window too short for the rail falls back to a rail that scrolls with the page.
- An ended session shows the full rail, so `Sign in again` is never squeezed into the icon rail.
- At phone width the rail is a fixed drawer. Hidden with `visibility`, it leaves the tab order and the accessibility tree while closed.

## Risks and tradeoffs

On a phone a destination is now two taps instead of one. The drawer is what later stories fill with pins and conversations, where a row of links would not scale. Below 1200px the main column is wider than before by default, so Home and other grids can place more columns at those widths.
