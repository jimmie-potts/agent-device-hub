## MODIFIED Requirements

### Requirement: Qualified explicit read receipts commit against the displayed target

The runtime SHALL explicitly adopt lifecycle/2.1 for a qualified authenticated producer. It SHALL require full identity, generation, known lifecycle turn, exact finished notice and eligible root activity to match inside its serialized owner operation. An owned-UI view revision SHALL match the exact session record used to bind the displayed target. Qualified producers SHALL include the observed Claude terminal implementation and the version-qualified Codex Desktop observer for the unchanged `codex/local` identity. Unqualified clients SHALL produce no positive read. A provider-client receipt SHALL carry the observed native revision and the matching accepted revision, with duplicate protection for the same accepted action.

Receipt evidence SHALL commit with the session revision, history and outbox. It SHALL NOT create a session, acknowledge a consumer, clear attention or refresh lifecycle evidence. Subsequent projection SHALL retain the receipt only for its eligible generation, turn and notice. An admitted native read update SHALL replace the receipt evidence. A removed session SHALL retain no active receipt.

#### Scenario: Matching explicit action
- **WHEN** a qualified Claude receipt matches the completed target and displayed revision
- **THEN** the core publishes read state with its receipt provenance at a new revision
- **AND** lifecycle freshness, attention and consumer acknowledgments remain unchanged

#### Scenario: Matching provider-client action
- **WHEN** a qualified Codex receipt carries an accepted native action and matches its frozen owner generation, completed turn and notice
- **THEN** the core commits and publishes that target's read provenance through the existing transaction and outbox
- **AND** the session remains `codex/local` with no added title or archive evidence

#### Scenario: Late or repeated action
- **WHEN** an older pane is clicked after any intervening session revision, including a new turn or unread observation, or the same receipt arrives again
- **THEN** it makes no new read transition and cannot clear a newer notice

#### Scenario: Obsolete provider target
- **WHEN** a Codex action arrives after its generation, turn or finished notice changed, or its accepted-action message is replayed after restart
- **THEN** it makes no new read transition and cannot clear a newer notice

#### Scenario: Failed commit and restart
- **WHEN** a receipt commit fails
- **THEN** neither the active record nor its publication changes
- **WHEN** a committed receipt is followed by a runtime restart
- **THEN** its matching read evidence survives with restart uncertainty and the outbox republishes without another user action

#### Scenario: Missing qualification
- **WHEN** an ordinary lifecycle credential, mismatched feed, unsupported client or invalid receipt reaches intake
- **THEN** the runtime refuses it under the existing shared error and diagnostic conventions without changing session state
