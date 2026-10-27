## MODIFIED Requirements

### Requirement: Passive filters and bounded read lifecycle

Timeline SHALL read the existing authenticated history API on entry, explicit
refresh and applied date/exact filters, with no polling or automatic retry.
Today, Yesterday and Recent plus All, Agents, Devices and Automation filters
SHALL be available. Existing exact kind, source, session and time filters SHALL
remain available. Every read SHALL request the latest 200 matching entries. The card SHALL identify that result window; category filters and Show more SHALL operate on loaded entries only, and empty category results MUST NOT imply an empty archive. An obsolete read MUST NOT replace a later read's rows or status;
unmount SHALL cancel pending reads. Loading, successful empty reads and failed
reads SHALL be distinguishable, including when retaining earlier rows.

#### Scenario: Filter without effects

- **WHEN** a read-only user filters, refreshes, inspects evidence or reloads
- **THEN** no command is sent and the requested history selection is shown

#### Scenario: Read failure and reverse completion

- **WHEN** reads finish out of order or the latest read fails or returns malformed rows
- **THEN** only the latest read controls presentation and retained rows are marked as earlier evidence

#### Scenario: Bound every Timeline read

- **WHEN** the user enters either surface, chooses Today, Yesterday or Recent, applies exact/date filters or refreshes
- **THEN** the request includes a limit of 200 and the card identifies the loaded result window
- **WHEN** the user selects a category or Show more
- **THEN** only loaded entries change presentation without another history read
