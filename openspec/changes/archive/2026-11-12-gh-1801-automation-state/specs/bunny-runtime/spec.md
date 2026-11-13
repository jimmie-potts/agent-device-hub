## ADDED Requirements

### Requirement: Saved automation definitions in sync and history

The core SHALL serve current saved event rules, weekly routines, automation settings and interrupt kinds through SDK sync, including definitions already present in its store and seeded defaults. The existing owner write paths SHALL commit an effective edit and its definition fact together through the core transaction and outbox. Rule and routine deletion SHALL retain a removal at the same ID. Failed writes SHALL leave the saved definition, evaluator, history and outbox unchanged. Repeated identical definitions, occurrence watermarks, budget use and automation log entries SHALL add no definition history.

#### Scenario: First sync on a populated store

- **WHEN** the core opens a store with rules, routines or legacy power windows, and edited settings
- **THEN** SDK sync serves the current owner values, including routines produced by the existing split
- **AND** the open and sync add no definition history

#### Scenario: Effective owner edits and refused saves

- **WHEN** an authorized owner creates, edits, enables, disables or deletes a rule or routine, or changes settings or interrupt kinds
- **THEN** history and sync reflect the committed definition edit or removal
- **WHEN** the transaction is refused
- **THEN** the previous definition is still current and governs evaluation, and there is no new fact or outbox message

#### Scenario: A queued definition becomes protected

- **GIVEN** a committed automation definition state awaits publication
- **WHEN** the live registry learns a protected value in that state before a later delivery
- **THEN** the outbox SHALL discard the state in settlement, without delivering it or counting it as sent
- **AND** later admissible messages SHALL retain their order and identities, and the owner definition and retained history SHALL stay intact
