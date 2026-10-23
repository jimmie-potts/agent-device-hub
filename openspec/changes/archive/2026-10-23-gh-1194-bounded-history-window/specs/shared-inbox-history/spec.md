## MODIFIED Requirements

### Requirement: Read-only filtered history surfaces

Every authorized reader SHALL see the whole inbox and history. Gateway and MCP history reads SHALL validate and combine inclusive time, kind, source and qualified-session filters without triggering actions. An optional `limit` SHALL accept only integers 1..500 and select the latest matching records by committed sequence before materializing or decoding the result, then return those records oldest first. Omitted limits SHALL preserve the complete matching result and existing ordering. Invalid or duplicate HTTP filters SHALL retain the existing invalid-request refusal and read authorization. The dashboard SHALL present the synced inbox and a keyboard-accessible filtered timeline, hide write controls from readers and disable stale writes.

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
