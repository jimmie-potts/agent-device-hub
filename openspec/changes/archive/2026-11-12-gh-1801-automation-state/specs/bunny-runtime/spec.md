## ADDED Requirements

### Requirement: Saved automation definitions in sync and history

The core SHALL serve current saved event rules, weekly routines, automation settings and interrupt kinds through SDK sync, including definitions already present in its store and seeded defaults. The existing owner write paths SHALL commit an effective edit and its definition fact together through the core transaction and outbox. Rule and routine deletion SHALL retain a removal at the same ID. Before staging a definition fact, the owner SHALL verify the route, type, subject and entity identity agree and SHALL refuse protected data in the outgoing route, subject or payload. An effective edit SHALL require both its pending outbox row and its retained history fact and metadata before committing. Failed writes SHALL leave the saved definition, evaluator, history and outbox unchanged. Repeated identical definitions, occurrence watermarks, budget use and automation log entries SHALL add no definition history.

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

- **GIVEN** a committed automation definition state or rule or routine removal awaits publication
- **WHEN** the live registry learns a protected value in the outgoing route, subject or payload before a later delivery
- **THEN** the outbox SHALL discard the message in its own settlement transaction, without delivering it or counting it as sent
- **AND** later admissible messages SHALL retain their order and identities, and the committed owner data and private history SHALL stay intact
- **AND** after a discarded removal, a fresh sync SHALL omit the deleted entity and the gateway SHALL refuse a cached value that contains the protected identity

#### Scenario: A public history read includes a newly protected definition

- **WHEN** the selected history rows include an automation definition carrying a value now protected by the live registry
- **THEN** HTTP and MCP SHALL refuse the read without exposing the value or changing retained history
- **AND** a filter that excludes the protected rows SHALL still serve its result
