## ADDED Requirements

### Requirement: Standard Home card heights
At the wide layout, Small, Standard and Wide Home cards SHALL share one standard height, defined once beside the width rule, so the cards in a row line up. A card SHALL NOT clip its controls: when content exceeds the standard height its row SHALL grow and every card in that row SHALL keep the row's height. Only cards the widget catalog marks tall, the art card and the music visualizer, MAY exceed the standard height. Where cards stack in one column, each card SHALL be as tall as its content. Saved Home arrangements SHALL load with the same widgets, order and sizes.

#### Scenario: Rows line up at every size
- **WHEN** Home shows Inbox, Hub mode, Agent status, Timeline and light cards at Small, Standard or Wide with an Inbox of 0, 1 or 13 items
- **THEN** every card in a row has the row's height, the visible card fills its slot, and a row of standard cards is exactly the standard height

#### Scenario: Media cards opt out in the catalog
- **WHEN** the widget catalog is read
- **THEN** only the art card and the music visualizer are marked tall

#### Scenario: Stacked cards keep content height
- **WHEN** Home is 375 px wide
- **THEN** cards are not held to the standard height and the page has no horizontal overflow

#### Scenario: A saved layout is unchanged
- **WHEN** an arrangement saved through the existing command loads
- **THEN** the saved record and the rendered Home keep its widgets, order and sizes

### Requirement: Paged Home list cards
Inbox, Agent status and Timeline SHALL page their lists through one shared component with Previous and Next controls and a "Page x of y" label, shown when a list needs a second page, instead of growing or scrolling inside the card. Rows per page SHALL fit the standard height; Agent status SHALL page whole rows of tiles at the card's current column count. Paging SHALL run in the browser over records the dashboard already holds and SHALL send no request or command. The Inbox SHALL show its total count on every page. Opening an Inbox item or Timeline entry SHALL give it the whole page so its controls stay inside the card; an opened agent tile SHALL stay beside the other tiles on its page. Removing the only entry on the last page SHALL show the previous page. After a page change or a removed or hidden focused entry, focus SHALL land on a control inside the list, never on the document body. Narrow screens SHALL page the same way.

#### Scenario: Page an Inbox of 13 items
- **WHEN** the Inbox holds more items than one page
- **THEN** it shows the first page, the total count and a disabled Previous; Next shows the following items, keeps the total count and leaves focus on a pager control

#### Scenario: Expanded item stays inside the card
- **WHEN** the owner opens an Inbox item
- **THEN** only that item is shown, its Send again and Dismiss controls lie inside the card at the standard height, and closing it restores the page

#### Scenario: Dismiss the last item on a page
- **WHEN** the owner dismisses the only item on the last page
- **THEN** the previous page is shown and focus is on a control inside the Inbox

#### Scenario: Agent status and Timeline use the same pager
- **WHEN** Agent status or Timeline holds more entries than one page
- **THEN** the shared pager shows other entries on the next page and returns, with focus on a pager control and no request sent
