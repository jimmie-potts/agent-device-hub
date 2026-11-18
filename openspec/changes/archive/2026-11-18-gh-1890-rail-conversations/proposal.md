## Why

The three chat profiles are chosen in a column on the Conversation page, so a conversation is one click away only from that page, and the column takes about 200px from the transcript and the composer. [Hub #1890](https://github.com/jimmie-potts/agent-device-hub/issues/1890), the last story of the navigation epic ([#1886](https://github.com/jimmie-potts/agent-device-hub/issues/1886)), moves the profiles into the rail, as the owner's accepted **Pinned** prototype does, and gives the page the width back.

## What changes

- The rail lists the three chat profiles in its bottom group, above Settings, on every page. A row opens the Conversation page on that profile. Reachy and MicroDuck are labelled Demo.
- A row is marked while its conversation needs the owner's answer or approval, and at phone width so is the menu button when that conversation is not the open one.
- The Conversation page loses its profile column, its narrow profile selector and its "Companion pages" disclosure. It keeps one header row: the profile's name, the Demo label and Details. The Devices menu reaches the other companion pages.
- The transcript's reading column and the composer share a measure of 920px, up from 760px.
- Settings and the feed indicator share one row at the bottom of the rail, which leaves room for the conversations.
- The line under the Pinned heading that explained pinning is removed, on the owner's direction of 2026-11-18. With nothing pinned the heading stands alone.

## Capabilities

### Modified capabilities

- `runtime-dashboard`: the rail requirement says where Settings and the feed indicator sit, the pinned pages requirement says what an empty list shows, and a requirement is added for the conversations in the rail.
- `bunny-assistant-tasks`: the Conversation workspace requirement names the one header row, the 920px measure and where a profile is chosen.

## Impact

The runtime dashboard shell and its stylesheet, the companions frontend's Conversation page and its stylesheet, one new frontend export of the companions module, their unit tests and browser journeys, and one verification capture change. `AssistantStatus`, the task summaries, the engine, every command, reply, event and error shape, permissions, history and state ownership stay the same. The rail group reads the assistant state through its own read-only copy and makes one bounded history read for each pending question; it sends no command and opens no speech endpoint.
