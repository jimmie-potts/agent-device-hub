## MODIFIED Requirements

### Requirement: Qualified explicit read receipts commit against the displayed target

The runtime SHALL explicitly adopt lifecycle/2.1 for a qualified authenticated producer. It SHALL require full identity, generation, known lifecycle turn, exact finished notice and eligible root activity to match inside its serialized owner operation. An owned-UI view revision SHALL match the exact session record used to bind the displayed target. Qualified producers SHALL include the Claude Code read plugin on its `terminal` and `desktop` surfaces at any Claude Code version, enrolled under the persisted feed `claude-terminal-read-2.1.292` and its unchanged receipt source ([Hub #2122](https://github.com/jimmie-potts/agent-device-hub/issues/2122)), and the protocol-qualified Codex Desktop observer for the unchanged `codex/local` identity. The Claude plugin and helper SHALL refuse the `vscode` and `mobile` surfaces with no read action and SHALL require no Claude Code version; a version passed for information SHALL NOT be compared. Unqualified clients SHALL produce no positive read. A provider-client receipt SHALL carry the observed native revision and the matching accepted revision, with duplicate protection for the same accepted action.

Receipt evidence SHALL commit with the session revision, history and outbox. It SHALL NOT create a session, acknowledge a consumer, clear attention or count as work evidence. Subsequent transitions SHALL retain the receipt only for its eligible generation, turn and notice. An admitted native read update SHALL replace the receipt evidence. A removed session SHALL retain no active receipt.

#### Scenario: Matching explicit action
- **WHEN** a qualified Claude receipt matches the completed target and displayed revision
- **THEN** the core publishes read state with its receipt provenance at a new revision
- **AND** the work claim, attention and consumer acknowledgments remain unchanged

#### Scenario: Desktop surface and unpinned version
- **WHEN** a Claude Code session on the `desktop` surface, at a version other than 2.1.292 or with no version reported, completes a reply and the user opens `/bunny-read` and presses **I read this reply**
- **THEN** the helper binds and commits the same receipt under the unchanged feed and source as a terminal press, and opening or rendering the panel sends no read

#### Scenario: Unchecked Claude surface
- **WHEN** `/bunny-read` runs or renders on the `vscode` or `mobile` surface, or the helper receives either surface
- **THEN** the panel says read receipts are unavailable, no read action is offered and the helper refuses the input with the invalid-request code

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
- **THEN** its matching read evidence survives the restart and the outbox republishes without another user action

#### Scenario: Missing qualification
- **WHEN** an ordinary lifecycle credential, mismatched feed, unsupported client or invalid receipt reaches intake
- **THEN** the runtime refuses it under the existing shared error and diagnostic conventions without changing session state

#### Scenario: Existing enrollment after a compatible Codex update
- **WHEN** the enrolled Codex producer observes the same qualified native action after an application update
- **THEN** the existing credential and full feed identity still qualify the receipt without re-enrollment
- **AND** all generation, turn, notice, replay and source checks still apply
