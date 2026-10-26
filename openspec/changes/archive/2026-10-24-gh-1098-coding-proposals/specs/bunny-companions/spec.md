## ADDED Requirements

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
