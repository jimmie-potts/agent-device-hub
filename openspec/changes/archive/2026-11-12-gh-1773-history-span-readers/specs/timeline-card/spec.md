## MODIFIED Requirements

### Requirement: Concise truthful history

Timeline SHALL show newest-first rows with action, context and time. Requests,
accepted replies, transmitted effects, observed effects, failures, uncertainty
and conflicts MUST remain distinct. Unknown record types SHALL retain a neutral
label and their original evidence. Selecting a row SHALL reveal concise evidence
and an optional technical record without any command.

Timeline SHALL say what a change row's span, gap or closing mark holds, and
nothing more (#1773). A change row with a span SHALL say how long the previous
state held, from the span's start to its last confirmation, and how many
readings history took in it. If the previous span's start is unknown or its
recorded times run backward, the row SHALL explain why it has no duration.
A gap row SHALL also give the time without a reading and report that the
next reading showed the same state. Its evidence SHALL say that the entry
does not establish a cause. A closing row SHALL say that it closes the readings before a removal and
changes nothing. A known open span SHALL appear on the entity's newest change
row in the page when its revision and recorded start match the row. It SHALL
give the start, last reading and count. If the recorded times run backward,
the line SHALL give both recorded instants and explain the clock step without
a duration. An open span with an unknown start SHALL have no row annotation.
The dedicated Timeline SHALL show it with the entity's label and family,
unknown start, last recorded reading and count, using the loaded entries and
selected category. A row without a span, a gap, a closing mark or a matching open span
SHALL read exactly as before. A missing or malformed `open` member SHALL
produce no open span presentation. A closed Home entry SHALL retain its height.
Recorded times SHALL never be described as now or as current device state.

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
- **THEN** Timeline titles the first "Readings resumed" with the preceding span's "After …" line and "No reading for 1 h 12 min, then the same state", titles the second "Last readings before removal" with the stretch it closes, and shows the removal as before

#### Scenario: The newest row of an entity with an open span

- **WHEN** the read returns an open span for an entity whose newest change row in the page matches the span's revision and recorded start
- **THEN** that row says "Unchanged since" its start and "last reading at" its last confirmation, with the reading count

#### Scenario: An unknown start after a date filter

- **WHEN** an entity has two same-revision change rows and a date filter excludes the newer one
- **THEN** the older row has no annotation for the entity's unknown-start span
- **AND** the dedicated Timeline shows the span for that entity separately, with the last recorded time and reading count, while the entity is in the selected category
