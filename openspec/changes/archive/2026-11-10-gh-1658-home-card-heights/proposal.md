## Why

[Issue #1658](https://github.com/jimmie-potts/agent-device-hub/issues/1658): a Home widget size set only a card's width, so card height followed content. On 2026-11-10 an Inbox of 13 items stood far taller than the cards beside it. The owner asked for uniform card sizes and paged lists. Owner decisions, 2026-11-10: D1, Inbox, Agent status and Timeline all page, with no in-card scrolling; D2, small, medium and large cards share one standard height so any row lines up, and only art and the music visualizer may be taller; D3, where cards stack in one column, lists still page and each card is as tall as its content.

## What Changes

- At the wide layout every Home card size shares one standard height, defined once beside the width rule. A row stretches to its tallest card, so a card that outgrows the height never clips its controls. Cards the widget catalog marks tall (art, music visualizer) may exceed it.
- Inbox, Agent status and Timeline page their lists through one shared pager: **Previous**, **Next** and "Page x of y". Paging runs in the browser over records the dashboard already holds; it adds no request and no polling path.
- The Inbox heading keeps the total count on every page. An opened Inbox item or Timeline entry takes the whole page so its controls stay inside the card; an agent tile opens in place so other sessions' attention stays in view. Dismissing the only item on the last page moves back a page. Focus moves to a control in the list rather than the page body after paging or a removed row.
- Timeline's **Show more** is replaced by the same pager; the dedicated Timeline page shows 20 entries a page.
- Stacked in one column, cards are as tall as their content and lists still page.

ADR 0012: no new message format, error shape, family, command or gateway route, and no new path that polls the Hub.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `home-layout`: standard Home card heights with a catalog opt-out, and paged list cards.
- `timeline-card`: paging over loaded entries replaces Show more.

`hub-control-cards` and `agent-status-cards` keep their requirements: their entries, expansion, handling and evidence are unchanged, and the paging they gain is stated once in `home-layout`.

## Impact

- `apps/runtime/dashboard`: the Home grid's height token and opt-out, the widget catalog's `tall` flag, the shared pager and page arithmetic, the Inbox, Agent status and Timeline cards, a browser journey chained from the Home editor journey, unit tests and the dashboard and runtime guides.
- Saved Home layouts keep their widgets, order and sizes; the stored record format is unchanged.
- No contract, schema, storage, migration, device, credential or runtime configuration change. Installation stays pending.
