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
Cards with approval, input or question attention SHALL have amber highlighting and written attention labels. Home SHALL omit a separate attention panel. The summary SHALL exclude stale or disconnected activity from current working counts.

#### Scenario: Current attention
- **WHEN** a session needs input, approval or a question answered
- **THEN** its own card is highlighted and opening it retains the highlight

#### Scenario: Stale and unread evidence
- **WHEN** an active record is stale or the session copy is disconnected
- **THEN** its face says Stale and it contributes no current working count; retained unread evidence is not acknowledged by inspection

### Requirement: Existing authority is preserved
The collection SHALL use the existing guarded label editor only for authorized callers, preserving stale/refused/uncertain handling and no replay.

#### Scenario: Read-only inspection
- **WHEN** a read-only caller opens a card
- **THEN** evidence remains readable and label controls are absent
