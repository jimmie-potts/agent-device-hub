## ADDED Requirements

### Requirement: Approved coding choice and explicit continuation

A new coding job SHALL bind approval to Auto or a named harness. Auto SHALL choose an eligible personal subscription and record the reason. A pinned refusal SHALL preserve the requested choice. Unknown quota SHALL remain unknown. An ambiguous or live attempt SHALL prevent an automatic replacement.

#### Scenario: Exhausted subscriptions

- **WHEN** the approved Auto job sees a preferred subscription with a rejected quota
- **THEN** the other eligible subscription can run the job and the reason is visible, including when the rejected quota has no known reset

#### Scenario: Continue a stopped writer

- **WHEN** the owner requests the other harness and the worker has terminal writer evidence and the same known worktree revision and changes
- **THEN** the job receives a distinct attempt with separate native identity, bounded handoff facts and its own checks

#### Scenario: Ambiguous start or stop

- **WHEN** a worker may still be writing, or the previous writer's proof is unavailable after restart
- **THEN** the coordinator or worker refuses a competing writer and sends no automatic retry
