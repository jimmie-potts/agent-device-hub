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
