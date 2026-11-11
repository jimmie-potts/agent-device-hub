## ADDED Requirements

### Requirement: Paged Home list cards
Inbox, Agent status and Timeline SHALL page their lists through one shared component instead of growing, so a long list never makes its card taller than one page of rows plus its heading and pager. The component SHALL show Previous and Next controls and a "Page x of y" label once a list needs a second page. Rows per page SHALL be fixed: Inbox 5, Timeline 5 on Home and 20 on its dedicated page, and Agent status two rows of tiles at the card's current column count. Agent status SHALL list sessions that need the owner first, in record order otherwise; when those sessions fill more than one page, the page label SHALL say so. Paging SHALL run in the browser over records the dashboard already holds and SHALL send no request or command. The Inbox SHALL show its total count on every page, and the Hub mode card's Check Inbox SHALL show the page holding its item before opening it. Entries SHALL open in place with the pager shown. Removing the only entry on the last page SHALL show the previous page. When focus is inside the list at a page change or when its entry is removed or hidden, focus SHALL land on a control inside the list, never on the document body. Focus that has left the list SHALL NOT be moved or scrolled back when an entry is later removed. Saved Home arrangements SHALL keep their widgets, order and sizes.

#### Scenario: Page an Inbox of 13 items
- **WHEN** the Inbox holds 13 items
- **THEN** it shows five, the total count and "Page 1 of 3" with Previous disabled, the card is no taller than one page plus its pager, and Next and Previous page by keyboard with focus on a pager control

#### Scenario: Open an item on a later page
- **WHEN** the owner opens an Inbox item on page 2
- **THEN** it opens in place beside the other items with the pager shown, and Send again and Dismiss are reachable by keyboard

#### Scenario: Dismiss the last item on a page
- **WHEN** the owner dismisses the only item on the last page
- **THEN** the previous page is shown and focus is on a control inside the Inbox

#### Scenario: Check Inbox lands on the item's page
- **WHEN** the Inbox shows another page and the owner chooses Check Inbox on the Hub mode card
- **THEN** the page holding the related item is shown, and the item is open and focused

#### Scenario: Focus that left the list stays put
- **WHEN** the owner moves focus from an Inbox row to a control outside the list and that row is then removed elsewhere
- **THEN** focus stays on that control and the page does not scroll

#### Scenario: A session that needs the owner is on the first page
- **WHEN** the last session in record order starts waiting for approval
- **THEN** it appears on the first page of Agent status; with more waiting sessions than one page holds, the page label says how many need the owner

#### Scenario: Agent status and Timeline use the same pager
- **WHEN** Agent status or Timeline holds more entries than one page
- **THEN** the shared pager shows other entries on the next page and returns, with no request sent
