# timeline-card Specification

## Purpose

Let the owner browse retained Hub activity through the same concise, read-only
Timeline card on Home and on the dedicated Timeline page.

## Requirements

### Requirement: Reusable placeable Timeline

The dashboard SHALL offer Timeline in the existing Home picker and reuse the
same card on the Timeline page. Existing saved layouts SHALL remain unchanged
until explicitly edited. Supported sizes SHALL remain usable on phone and desktop.

#### Scenario: Add and retain the card

- **WHEN** the owner adds, moves, resizes or hides Timeline and saves Home
- **THEN** reload retains the arrangement through the existing Home layout owner
- **AND** Timeline renders the same controls and evidence on either surface

### Requirement: Concise truthful history

Timeline SHALL show newest-first rows with action, context and time. Requests,
accepted replies, transmitted effects, observed effects, failures, uncertainty
and conflicts MUST remain distinct. Unknown record types SHALL retain a neutral
label and their original evidence. Selecting a row SHALL reveal concise evidence
and an optional technical record without any command.

#### Scenario: A request has no observed effect

- **WHEN** history contains a sent power request without completion
- **THEN** Timeline labels it requested and does not claim a light switched

#### Scenario: Inspect retained evidence

- **WHEN** the owner selects a known or unknown row by pointer or keyboard
- **THEN** its evidence is available, and closing it or pressing Escape restores row focus

### Requirement: Passive filters and bounded read lifecycle

Timeline SHALL read the existing authenticated history API on entry, explicit
refresh and applied date/exact filters, with no polling or automatic retry.
Today, Yesterday and Recent plus All, Agents, Devices and Automation filters
SHALL be available. Existing exact kind, source, session and time filters SHALL
remain available. An obsolete read MUST NOT replace a later read's rows or status;
unmount SHALL cancel pending reads. Loading, successful empty reads and failed
reads SHALL be distinguishable, including when retaining earlier rows.

#### Scenario: Filter without effects

- **WHEN** a read-only user filters, refreshes, inspects evidence or reloads
- **THEN** no command is sent and the requested history selection is shown

#### Scenario: Read failure and reverse completion

- **WHEN** reads finish out of order or the latest read fails or returns malformed rows
- **THEN** only the latest read controls presentation and retained rows are marked as earlier evidence

### Requirement: Accessible quiet presentation

Rows, filters and evidence SHALL work by keyboard with visible focus, reduced
motion and readable light/dark themes, without horizontal overflow at supported
phone and desktop widths.

#### Scenario: Browse on a narrow screen

- **WHEN** a user browses or opens evidence at 320 px, phone or desktop width
- **THEN** controls and evidence fit, remain accessible and do not send commands
