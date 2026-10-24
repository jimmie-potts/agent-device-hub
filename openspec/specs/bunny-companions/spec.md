## Purpose

Provide attributed fixed-text virtual Reachy cards in the existing dashboard from qualified coding occurrences and clearly isolated synthetic scenarios.

## Requirements

### Requirement: Qualified live coding cards
The system SHALL reduce supported Codex and Claude metadata once in the core and admit at most one companion opportunity from the first live publication. Each card SHALL preserve source/event, source revision and generation, known session/turn/attention identity, evidence, occurrence time and validity deadline. Unknown identity SHALL remain unknown.

#### Scenario: Attention requests a person
- **WHEN** a current qualified question, input or approval occurrence arrives with companions enabled
- **THEN** Reachy identifies its session and requests human attention without answering, recommending approval or launching a worker
- **AND** required coding attention remains eligible in Work and Quiet

#### Scenario: A turn ends without content
- **WHEN** a qualified current turn-ended occurrence arrives
- **THEN** the quiet card states only that the turn ended and content is unavailable
- **AND** it invents no success, summary, test result or next prompt

#### Scenario: Recovery and duplicates
- **WHEN** input is duplicated, stale, out of order, recovered from an outbox, synced, reconnected or restarted
- **THEN** it creates no new reaction admission
- **AND** restart or return to Free never replays missed opportunities

### Requirement: Final validity and bounded arbitration
The system SHALL retain one active reaction and at most one waiting candidate per coding-attention, coding-notice and simulated-social category. It SHALL coalesce source/session candidates, discard obsolete or expired evidence and give coding attention precedence. It SHALL recheck enablement, mute, mode, source freshness, active attention/turn, output availability and expiry after asynchronous waiting and immediately before presentation.

#### Scenario: State changes during delivery
- **WHEN** a delivery waits and attention clears, a turn is superseded, mode changes restrictively, a category is muted, companions are disabled or evidence expires
- **THEN** the final validity check refuses the obsolete presentation with an inspectable reason
- **AND** core attention remains usable

#### Scenario: Output cannot complete
- **WHEN** input is malformed or refused, or presentation is unavailable, fails or times out
- **THEN** the result truthfully reports refusal or unavailable presentation
- **AND** no second endpoint is tried and emitted state is never claimed to have been seen

### Requirement: Isolated simulated social decisions
The system SHALL label arrival and visit fixtures as synthetic, with identity and location explicitly unknown, and route them through the same admission, text and presentation functions. Social admission SHALL require fresh Free mode, known non-busy/non-media facts, no active coding attention, no snooze, and one shared allowance of three episodes per local day with at least three hours between episodes. Scenario facts, repetition and allowance SHALL remain isolated from live household facts and records. Seeded variation and fixed-clock decisions SHALL be repeatable.

#### Scenario: Mixed synthetic priorities
- **WHEN** a simulated arrival and coding question compete in a labelled scenario
- **THEN** coding attention wins and synthetic arrival cannot become real perception, memory, speech or physical output

#### Scenario: Budget and snooze
- **WHEN** a scenario exceeds repetition, the shared social budget or spacing, has unknown busy/media evidence, or is snoozed
- **THEN** it produces no social reaction and exposes the corresponding decision reason
- **AND** scenario admission spends no live social slot

### Requirement: Persistent optional dashboard presence
The module SHALL persist only settings and bounded admission/repetition/presentation records privately. It SHALL sync authoritative core state, keep pending candidates in memory only, preserve a saved card as history without another reaction, and default to disabled. The authenticated React page SHALL expose enablement, category mute, social snooze, source/session, real versus simulated metadata, evidence, selected text and a code-owned reason. Existing hook and session attention behavior SHALL remain usable independently of this module. The default implementation SHALL perform zero model calls, audio output or device commands.

#### Scenario: Controls and restart
- **WHEN** an authorized operator changes enablement or category controls and restarts
- **THEN** controls persist and no pending or missed reaction is replayed
- **AND** a saved card is explicitly history, not newly observed activity

#### Scenario: Accessible and read-only interface
- **WHEN** a reader opens the page or a keyboard user operates it
- **THEN** source metadata and decision reasons are legible and accessible
- **AND** reader authority cannot change controls or submit fixtures

### Requirement: Deliberate grounded coding suggestions
The Reachy page SHALL accept a bounded owner-supplied form for one known synced coding session and named task, with explicit check statuses, observation time, evidence references and owner-reported current and evidence revisions. Passed, failed, skipped, unrun and unknown SHALL remain distinct. Unknown turn, base or repository SHALL remain unknown. Input and preview SHALL remain transient browser data, without capture, persistence or provider calls.

#### Scenario: Tests pass and browser is unrun
- **WHEN** the owner supplies fresh matching-head evidence for passed tests and an explicitly unrun browser check
- **THEN** a deterministic inspect/copy prompt proposes the browser check and shows both statuses, references, attribution, target task/session/turn, known revisions and expiry
- **AND** the result makes no independent claim that tests passed

#### Scenario: Insufficient or ambiguous evidence
- **WHEN** only turn-ended metadata exists, task identity is absent, a claim is unsupported, evidence is stale/future, a result is ambiguous or head revisions differ
- **THEN** the page shows no proposal or an explicit evidence gap without invented success

#### Scenario: Isolated supersession without replay
- **WHEN** task/session/context changes, newer evidence replaces the form, older evidence is submitted, or a disconnect/reconnect/sync occurs
- **THEN** the old proposal cannot be copied or contaminate the new task/session, older evidence cannot restore it, and sync never admits a proposal
- **AND** identical repeated inspection creates no additional admission

### Requirement: Policy guarded inspect and copy
Suggestions SHALL reuse Reachy enablement/category mute, current source freshness and attention priority. The page SHALL recheck policy, source context, input and expiry immediately before copy. Copy SHALL occur only on the owner's explicit action; it SHALL change only the clipboard. Keyboard, narrow viewport and accessible inspection SHALL be supported.

#### Scenario: Policy or source changes
- **WHEN** Reachy is disabled/muted, output/core is unavailable, attention takes priority, the selected session/turn changes or evidence expires
- **THEN** the suggestion is unavailable with a reason and cannot be copied
- **AND** normal session attention remains independent

#### Scenario: Explicit clipboard and safe failure
- **WHEN** the owner inspects without copying, explicitly copies, or clipboard access fails
- **THEN** inspection changes no clipboard, a valid explicit copy contains the attributed prompt, and failure reports that copying could not be confirmed
- **AND** no composer typing, harness API, submission, approval, task continuation, audio or device command occurs
