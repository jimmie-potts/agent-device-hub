## MODIFIED Requirements

### Requirement: Read-only filtered history surfaces

Every authorized reader SHALL see the whole inbox and history. Gateway and MCP history reads SHALL validate and combine inclusive time, kind, source and qualified-session filters without triggering actions. An optional `limit` SHALL accept only integers 1..500 and select the latest matching records by committed sequence before materializing or decoding the result, then return those records oldest first. Omitted limits SHALL preserve the complete matching result and existing ordering. Invalid or duplicate HTTP filters SHALL retain the existing invalid-request refusal and read authorization. The dashboard SHALL present the synced inbox and a keyboard-accessible filtered timeline, hide write controls from readers and disable stale writes.

The gateway's history read SHALL also return, as the optional member `open` of `history/2.0`, the open span of each entity that has a change row in the returned rows (#1773): the span the entity's next row would close if it came now, when it holds more than its row's reading. Each entry SHALL give the entity's source, family and ID, the revision of the entity's last row, the span's start (`sinceAtMs`, null when unknown), its last confirmation (`lastConfirmedAtMs`) and the number of readings history took in it (`confirmations`), as history holds them. The core SHALL find them with one keyed lookup per distinct entity with a change row in the page and none for other rows. A span the history intake would reset, and the span of an entity whose last row is a removal, SHALL not be returned. A page with no such span SHALL answer exactly as before, without `open`. Open spans SHALL not be facts: a read after a sequence SHALL never return them. The MCP history tool SHALL return the same page with required `rows` and optional `open`, as declared in its closed published result schema.

#### Scenario: Shared handling and private retained reads
- **WHEN** an operator handles an item in the dashboard
- **THEN** a subsequent MCP inbox read shows it absent
- **WHEN** a reader filters history or reloads the dashboard
- **THEN** no device command is sent

#### Scenario: Bounded matching read
- **WHEN** HTTP or MCP reads more than 500 retained records with combined filters and a limit of 1, 200 or 500
- **THEN** only the latest matching records up to that limit are materialized and returned oldest first
- **AND** other retained records remain unchanged and available through existing reads

#### Scenario: Invalid limit
- **WHEN** a reader supplies a zero, negative, fractional, oversized or noninteger limit, or repeats the HTTP parameter
- **THEN** the read is refused with invalid-request without commands or privilege changes

#### Scenario: Open spans of the entities in a page
- **WHEN** a lamp has a change row and 59 confirmations, a fan has two change rows and two confirmations after the second, and a heater has one row and no confirmation, and a reader reads history over HTTP
- **THEN** the answer holds the rows as before and `open` with the lamp's and the fan's spans, found with three keyed lookups, and nothing for the heater

#### Scenario: A page without open spans
- **WHEN** a reader reads a page with no change row, or whose entities hold no open span
- **THEN** the answer is byte for byte the answer before #1773, and a reader that reads only `rows` reads the same rows from an answer with `open`

#### Scenario: Open spans are not facts
- **WHEN** a peer reads history after a sequence
- **THEN** it receives rows only, never an open span

#### Scenario: The MCP tool reads the history page
- **WHEN** an MCP client lists the tools and calls `core_history`
- **THEN** the published result schema is closed with required `rows` and optional `open`
- **AND** the result contains the same rows and optional spans as the matching HTTP read
