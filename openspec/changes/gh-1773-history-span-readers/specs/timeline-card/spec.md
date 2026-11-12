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
