## MODIFIED Requirements

### Requirement: Final validity and bounded arbitration
The system SHALL retain one active reaction and at most one waiting candidate per coding-attention, coding-notice and simulated-social category. It SHALL coalesce source/session candidates, discard obsolete or expired evidence and give coding attention precedence within its question window. It SHALL recheck enablement, mute, mode, the opportunity's match to its session (generation, identity, turn, and the attention item or notice it names), output availability and expiry after asynchronous waiting and immediately before presentation. No session freshness, restart or session-age term SHALL refuse a live card.

#### Scenario: State changes during delivery
- **WHEN** a delivery waits and attention clears, a turn is superseded, mode changes restrictively, a category is muted, companions are disabled or evidence expires
- **THEN** the final validity check refuses the obsolete presentation with an inspectable reason
- **AND** core attention remains usable

#### Scenario: Output cannot complete
- **WHEN** input is malformed or refused, or presentation is unavailable, fails or times out
- **THEN** the result truthfully reports refusal or unavailable presentation
- **AND** no second endpoint is tried and emitted state is never claimed to have been seen

#### Scenario: A quiet session's notice
- **WHEN** a turn-ended opportunity arrives for a session that was silent for six minutes before the turn ended
- **THEN** the card is admitted while its opportunity matches and is valid

### Requirement: Policy guarded inspect and copy
Suggestions SHALL reuse Reachy enablement/category mute, the exact synced session, revision, generation and turn, the suggestion's own evidence window and the question priority window. The page SHALL recheck policy, source context, input and expiry immediately before copy. Copy SHALL occur only on the owner's explicit action; it SHALL change only the clipboard. Keyboard and narrow viewport inspection SHALL be supported.

#### Scenario: Policy or source changes
- **WHEN** Reachy is disabled/muted, output/core is unavailable, a question's priority window is open, the selected session/turn changes or evidence expires
- **THEN** the suggestion is unavailable with a reason and cannot be copied
- **AND** normal session attention remains independent

#### Scenario: Explicit clipboard and safe failure
- **WHEN** the owner inspects without copying, explicitly copies, or clipboard access fails
- **THEN** inspection changes no clipboard, a valid explicit copy contains the attributed prompt, and failure reports that copying could not be confirmed
- **AND** no composer typing, harness API, submission, approval, task continuation, audio or device command occurs

#### Scenario: A session quiet after its turn
- **WHEN** the owner inspects a suggestion for a session whose turn ended ten minutes ago, with fresh matching evidence
- **THEN** the session's silence does not make the suggestion unavailable

## ADDED Requirements

### Requirement: Thirty-second question priority
An unanswered question, input request or approval SHALL take priority over background cards, simulated social cards, suggestions and automatic speech for 30 seconds from its own evidence instant on the reporting host's clock, as the existing opportunity's validity sets it. The window SHALL be held in memory from admitted coding-attention opportunities and SHALL end early when the attention item clears. The question SHALL stay visible afterward. Unrelated progress SHALL NOT renew the window, and a restart SHALL start no new window. Explicitly requested assistant answers SHALL stay outside this rule. When the reporting host's clock runs ahead of the hub's, or 30 seconds or more behind it, the core SHALL drop that question's opportunity as today, so the question gets no priority window while status devices still show it; a host clock behind by less SHALL shorten the window.

#### Scenario: Inside and after the window
- **WHEN** a question is raised and a background card waits, and the clock moves to 29 s and then 30 s after the question's evidence instant
- **THEN** the card is refused with `attention-priority` at 29 s and admitted at 30 s, while the question stays shown

#### Scenario: Progress and restart
- **WHEN** unrelated progress arrives 20 s after a question, and the runtime restarts while the question is still open
- **THEN** progress does not extend the window, and after the restart no window is open and no card or speech replays

#### Scenario: A host clock ahead of the hub
- **WHEN** the reporting host's clock runs a minute ahead of the hub's and the host reports a question
- **THEN** the core raises no opportunity for it, no priority window opens, and the session still needs the owner on every status device

#### Scenario: A host clock behind the hub
- **WHEN** one host's clock runs 40 seconds behind the hub's and another's runs 10 seconds behind, and each reports a question
- **THEN** the core raises no opportunity for the first, and the second's priority window ends 20 seconds after the hub received it
