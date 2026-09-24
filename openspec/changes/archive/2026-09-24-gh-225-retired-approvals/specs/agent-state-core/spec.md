## ADDED Requirements

### Requirement: Retired-turn approvals without a request ID
The owner SHALL forget an approval without a request ID once it retires that approval's known turn, and SHALL NOT retain such an approval that arrives for a turn it already retired. On startup it SHALL remove stored approvals of that kind on already-retired turns in one durable revision without a journal row. Approvals on the current turn or on turns the owner never selected, approvals with a request ID, questions and input requests MUST remain. Forgetting MUST NOT record a permission decision, acknowledgment, success or cancellation.

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

## MODIFIED Requirements

### Requirement: Best-effort current-turn selection
For a session without qualified activity ordering, a valid start with known session and turn identity that has not already been selected, retired or completed within the retained evidence SHALL select that turn and set activity active. A matching stop SHALL set its activity idle and retain a stable completion notice without claiming success or readership. A new selection SHALL clear prior known-turn completion notices only for consumers whose clearOnNewTurn policy enables it. Attention, read evidence, other sessions and explicit consumer-scoped acknowledgment MUST remain independent, except that retiring a turn forgets its approvals without a request ID. Provider ordering MUST remain unknown when it was unknown at ingestion.

#### Scenario: Ordinary provider lifecycle
- **WHEN** the actual provider normalizer and packaged hook deliver start A, stop A and start B with unknown ordering
- **THEN** activity progresses active, idle and active, the current turn is B, A's notice clears only for enabled consumers, and no synthetic provider sequence is needed

#### Scenario: Duplicate or delayed selected-turn start
- **WHEN** a selected turn's start repeats while active or arrives after its completion
- **THEN** it cannot refresh duplicate evidence, reactivate the completed turn, clear unrelated notices or undo acknowledgment

#### Scenario: Independent attention and sessions
- **WHEN** one session starts a new turn while it retains approval/input attention and another session has activity and notices
- **THEN** the new turn preserves that attention and the other session, except an approval without a request ID on the retired turn, and a correlated attention resolution or notice acknowledgment affects only its named item and consumer

#### Scenario: Previously unseen delayed start
- **WHEN** a valid start for an older but unremembered turn arrives after the current turn
- **THEN** receipt-based selection can choose it and clear covered notices, while ordering remains unknown and the documented limitation makes no provider-order or reliable-history claim

#### Scenario: Genuine ordering remains authoritative evidence
- **WHEN** comparable qualified ordering is available, or an unordered observation conflicts with a session's qualified activity ordering
- **THEN** existing sequence and epoch checks remain effective and the receipt fallback cannot retire a turn supported by that ordering

#### Scenario: Qualified attention arrives before its turn start
- **WHEN** a newer comparable qualified attention observation precedes the delivery of its earlier turn start
- **THEN** the attention observation establishes its turn and preserves its attention immediately, retires the old turn and clears only enabled old-turn notices, and the delayed start cannot undo that observation
