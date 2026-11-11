## Why

[Issue #1658](https://github.com/jimmie-potts/agent-device-hub/issues/1658), second follow-on on the same delivery branch. Independent review of PR #1665 at `78d4c557` found cards held to a standard height when each sat alone in its row between the phone and wide layouts, focus pulled back into a list it had left, a waiting session paged out of view, Timeline keeping its page across a new category or period, Wispr with 2 px of headroom, unequal widths for same-size cards, and opened entries taking the page where no card height applies.

## What Changes

- A card alone in a row it does not fill by choice takes its content height; Wide cards keep the standard height.
- Short is 464 px and long 944 px, so Wispr (446 px) has 18 px of headroom.
- Same-size cards sharing a row get equal whole-column spans when the 24 columns allow, and Standard keeps its preferred width when a split allows.
- Agent status lists sessions that need the owner first; when they fill more than a page, the page label says how many.
- A new Timeline category or period returns to the first page.
- An opened entry takes the page only inside a Home card held to a standard height.
- The pager forgets focus that leaves the list, so a later removal never moves or scrolls focus.

ADR 0012: no new message format, error shape, family, command or gateway route, and no polling path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: content height for a lone card, equal widths, attention-first sessions, expansion only where a height applies, focus that has left the list.
- `timeline-card`: a new category or period starts at the first page.

## Impact

`apps/runtime/dashboard` only: Home packing and CSS, the shared pager, Agent status, Timeline, unit and browser tests, and the dashboard guide. Saved layouts and the stored format are unchanged. Installation stays pending.
