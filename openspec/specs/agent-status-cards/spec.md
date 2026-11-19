# Agent status cards

## Purpose

Present concise reusable agent status cards on the dashboard while preserving attention, freshness, unread evidence and guarded label controls.

## Requirements

### Requirement: Reusable agent cards
The dashboard SHALL expose reusable card, summary and collection components over the existing core session copy, with concise faces and native keyboard disclosure for retained evidence and optional label controls.

#### Scenario: Inspect and filter without effects
- **WHEN** a person opens a card or filters sessions
- **THEN** the card shows the existing evidence without sending a command or clearing a notice, and filtering preserves mounted card drafts

#### Scenario: Replace a session generation
- **WHEN** the core replaces a session generation
- **THEN** its old disclosure and label draft are retired

### Requirement: Attention and freshness remain distinct
Cards with approval, input or question attention SHALL have amber highlighting and written attention labels; a session that needs the owner for a detail this version does not know SHALL show **Needs you** in the same blocked color. Home SHALL omit a separate attention panel. A card SHALL show the hub's shared status and SHALL NOT age it: a working session whose work is unconfirmed SHALL say **Unconfirmed** and add no current working count, a session whose status is unknown SHALL be marked uncertain, and only a session copy that is not synced SHALL say **Stale**. Silence SHALL NOT mark any session (Hub #1947); the face SHALL instead show how long ago the hub last heard from the session, from the record's evidence time against the page's clock. The summary SHALL exclude unconfirmed or unsynced work from current working counts and SHALL count retained unread evidence independently of higher-priority attention or activity.

#### Scenario: Current attention
- **WHEN** a session needs input, approval or a question answered
- **THEN** its own card is highlighted and opening it retains the highlight

#### Scenario: Stale and unread evidence
- **WHEN** an active session's work is unconfirmed, or the session copy is not synced
- **THEN** the face says Unconfirmed for the unconfirmed work and Stale for the unsynced copy, and neither contributes a current working count; retained unread evidence is not acknowledged by inspection

#### Scenario: Silence on a waiting or finished session
- **WHEN** a session waiting on a question, a session holding an unread finished turn and a working session stay silent for ten minutes on a synced copy
- **THEN** their faces keep Question, Finished · unread and Working, none is marked uncertain, and each says Heard 10m ago

### Requirement: Existing authority is preserved
The collection SHALL use the existing guarded label editor only for authorized callers, preserving refused and uncertain reply handling and no replay. Label controls SHALL be disabled only while the session copy is not synced; the session's status does not disable them, because the label is the owner's own data, and the expected-revision guard still refuses an attempt on a changed record.

#### Scenario: Read-only inspection
- **WHEN** a read-only caller opens a card
- **THEN** evidence remains readable and label controls are absent

#### Scenario: Label on an uncertain session
- **WHEN** an authorized caller opens a card whose status is unknown or whose work is unconfirmed on a synced copy
- **THEN** the label editor is available, and a copy that is not synced disables it
