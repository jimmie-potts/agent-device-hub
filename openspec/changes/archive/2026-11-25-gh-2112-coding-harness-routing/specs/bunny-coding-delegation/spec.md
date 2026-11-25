## ADDED Requirements

### Requirement: Approved coding choice and explicit continuation

A new coding job SHALL bind approval to Auto or a named harness. Auto SHALL choose an eligible personal subscription and record the reason. A pinned refusal SHALL preserve the requested choice. Unknown quota SHALL remain unknown. An ambiguous or live attempt SHALL prevent an automatic replacement.

#### Scenario: Exhausted subscriptions

- **WHEN** the approved Auto job sees a preferred subscription with a rejected quota
- **THEN** the other eligible subscription can run the job and the reason is visible, including when the rejected quota has no known reset

#### Scenario: Continue a stopped and confined writer

- **WHEN** the owner requests Claude Code after a stopped Codex attempt on a supported Mac worker, the native sandbox excludes the successor, and the worker confirms the source checkout identity, revision, index and selected files
- **THEN** the job receives a distinct attempt in a separate checkout and Git store with the same verified state, the full approved brief, bounded Git and check facts, and its own native identity and checks

#### Scenario: Incomplete snapshot or confinement

- **WHEN** the previous writer lacks verified native confinement, or the source identity, revision, index or verified contents differ
- **THEN** the continuation remains unavailable and no replacement writer starts

#### Scenario: Ambiguous start or stop

- **WHEN** a worker may still be writing, or the previous writer's proof is unavailable after restart
- **THEN** the coordinator or worker refuses a competing writer and sends no automatic retry
