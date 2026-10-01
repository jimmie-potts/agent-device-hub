## MODIFIED Requirements

### Requirement: Retired-turn approvals without a request ID
The owner SHALL forget an approval without a request ID once it retires that approval's known turn, and SHALL NOT retain such an approval that arrives for a turn it already retired. On startup it SHALL remove stored approvals of that kind on already-retired turns in one durable revision without a journal row. When another turn starts, approvals on the current turn or on turns the owner never selected, approvals with a request ID, questions and input requests MUST remain. Forgetting MUST NOT record a permission decision, acknowledgment, success or cancellation.

#### Scenario: Newer turn starts
- **WHEN** a session holds an approval without a request ID on its current turn and a newer turn is selected
- **THEN** the approval is removed and the new turn is current

#### Scenario: Current or unselected turn
- **WHEN** an approval without a request ID is on the current turn or on a turn the owner never selected
- **THEN** it remains when another turn starts

#### Scenario: Late approval for a retired turn
- **WHEN** an approval without a request ID arrives for a turn the session already retired
- **THEN** it is not retained

#### Scenario: Stored backlog
- **WHEN** the owner starts from a store holding approvals without a request ID on retired turns
- **THEN** one new revision removes them, and a restart keeps them removed

## ADDED Requirements

### Requirement: Answered and ended-turn approvals without a request ID
The owner SHALL forget every approval without a request ID on a session's known turn T when that session accepts an `attention.resolved` with a known ID on turn T, or a `turn.ended` on turn T. Approvals on other turns or in other sessions, approvals with a request ID other than the one resolved, questions and input requests MUST remain. An event without a known turn MUST NOT forget an approval, and a known-ID resolution that matches no item MUST NOT change attention or add ambiguity. Forgetting MUST NOT record a permission decision, acknowledgment, success or cancellation. A later approval on turn T SHALL create a new marker.

#### Scenario: Tool evidence after an answered dialog
- **WHEN** a session holds an approval without a request ID on turn T and accepts a known-ID resolution on T
- **THEN** the approval is removed, and activity, notices and acknowledgments are unchanged

#### Scenario: Turn ends after a denied dialog
- **WHEN** a session holds an approval without a request ID on turn T and accepts a `turn.ended` on T
- **THEN** the approval is removed

#### Scenario: Other turn, session or kind
- **WHEN** the resolution or turn end names another turn or session, or the marker is a question, an input request or an approval with a different request ID
- **THEN** the marker remains

#### Scenario: Missing turn or unmatched resolution
- **WHEN** a resolution or turn end has no known turn, or a known-ID resolution on T matches no attention item
- **THEN** no approval is forgotten, and an unmatched resolution adds no attention ambiguity

#### Scenario: Later approval on the same turn
- **WHEN** an approval without a request ID arrives on turn T after a resolution on T
- **THEN** a new marker exists
