# timeline-card Specification

## Purpose

Let the owner browse retained Hub activity through the same concise, read-only
Timeline card on Home and on the dedicated Timeline page.

## Requirements

### Requirement: Reusable placeable Timeline

The dashboard SHALL offer Timeline in the existing Home picker and reuse the
same card on the Timeline page. Existing saved layouts SHALL remain unchanged
until explicitly edited. On the Home unit grid Timeline SHALL offer all four
shapes: one row shows its latest entries and Open Timeline, Tall adds the period,
refresh and paging, and Large square adds the category filters; every control a
shape leaves out SHALL remain on the Timeline page. Phone and narrow layouts and
the Timeline page SHALL show the full card.

#### Scenario: Add and retain the card

- **WHEN** the owner adds, moves, changes the shape of or hides Timeline and saves Home
- **THEN** reload retains the arrangement through the existing Home layout owner
- **AND** Timeline renders the same evidence on either surface, with the controls its shape shows

#### Scenario: Timeline in one unit

- **WHEN** Timeline is a Small square on Home
- **THEN** it shows its latest two entries and Open Timeline, with no pager, and Open Timeline leads to the full card

### Requirement: Concise truthful history

Timeline SHALL show newest-first rows with action, context and time. Requests,
accepted replies, transmitted effects, observed effects, failures, uncertainty
and conflicts MUST remain distinct. Unknown record types SHALL retain a neutral
label and their original evidence. Selecting a row SHALL reveal concise evidence
and an optional technical record without any command.

Timeline SHALL say what a change row's span, gap or closing mark holds, and
nothing more (#1773). A change row with a span SHALL say how long the previous
state held, from the span's start to its last confirmation, and how many
readings history took in it. A gap row SHALL say how long no reading came and
that the next showed the same state, and that the entry does not say why, as
the recorded times show it, never a cause. A closing row SHALL say that it
closes the readings before a removal and changes nothing. The newest change row
of an entity whose open span the read returned, when it is the row the span
continues, SHALL say since when the state has been unchanged and when the last
reading was taken, as recorded instants, never as now. An unknown start SHALL
be said to be unknown; when the recorded times run backward, no length SHALL
be shown. A row without a span, a gap, a closing mark or an open span SHALL read
exactly as before, and an answer without `open`, or with one that is malformed,
SHALL show no open span. In a Home shape these lines show only when the entry is
open, so a closed entry keeps its height.

#### Scenario: A request has no observed effect

- **WHEN** history contains a sent power request without completion
- **THEN** Timeline labels it requested and does not claim a light switched

#### Scenario: Inspect retained evidence

- **WHEN** the owner selects a known or unknown row by pointer or keyboard
- **THEN** its evidence is available, and closing it or pressing Escape restores row focus

#### Scenario: A change after a span

- **WHEN** a change row carries a span from 4 h 29 min before its last confirmation with 3,300 readings
- **THEN** Timeline says "After 4 h 29 min unchanged, 3,300 readings" under the row's context

#### Scenario: A gap and a closing row

- **WHEN** history holds a gap row after 1 h 12 min without a reading, and a closing row followed by its removal
- **THEN** Timeline titles the first "Readings resumed" with "No reading for 1 h 12 min, then the same state", titles the second "Last readings before removal" with the stretch it closes, and shows the removal as before

#### Scenario: The newest row of an entity with an open span

- **WHEN** the read returns an open span for the entity of the newest change row
- **THEN** that row says "Unchanged since" its start and "last reading at" its last confirmation, and no row says now

### Requirement: Passive filters and bounded read lifecycle

Timeline SHALL read the existing authenticated history API on entry, explicit
refresh and applied date/exact filters, with no polling or automatic retry.
Today, Yesterday and Recent plus All, Agents, Devices and Automation filters
SHALL be available. Existing exact kind, source, session and time filters SHALL
remain available. Every read SHALL request the latest 200 matching entries. The card SHALL identify that result window; category filters and paging SHALL operate on loaded entries only, a new category or period SHALL return to the first page, and empty category results MUST NOT imply an empty archive. An obsolete read MUST NOT replace a later read's rows or status;
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
- **WHEN** the user selects a category or another page
- **THEN** only loaded entries change presentation without another history read

#### Scenario: A new category or period starts at the first page
- **WHEN** the user is on a later page and chooses another category or period
- **THEN** the first page of the new selection is shown

### Requirement: Quiet presentation

Rows, filters and evidence SHALL work by keyboard with visible focus and readable light/dark themes, without horizontal overflow at supported
phone and desktop widths.

#### Scenario: Browse on a narrow screen

- **WHEN** a user browses or opens evidence at 320 px, phone or desktop width
- **THEN** controls and evidence fit, remain accessible and do not send commands
