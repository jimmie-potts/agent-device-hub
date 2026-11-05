## ADDED Requirements

### Requirement: Saved composition preparation has a completed staging outcome
The Art owner SHALL accept a core-only request to prepare one existing display composition without a provider call or display effect. Admission SHALL remain distinct from its final tracked outcome. Success SHALL mean the target owner confirmed staging that exact composition. Missing or deleted art, a missing rendition, absent current capability, refusal and uncertainty SHALL remain distinguishable. A duplicate request SHALL NOT stage again, and restart SHALL NOT resend pending preparation.

#### Scenario: A target admits staging but has not completed it
- **WHEN** the display admits the stage command and has not yet reported its outcome
- **THEN** the preparation remains pending rather than claiming success
- **AND** other targets can prepare and complete independently

#### Scenario: Preparation loses its response or restarts
- **WHEN** a preparation loses its final evidence or the Art owner restarts with it pending
- **THEN** the retained operation records uncertainty without a provider call, automatic resend or display effect

### Requirement: Browser selection belongs to the private Art catalog
The core SHALL select an existing successful browser composition through the Art owner. The selection SHALL be committed with its tracked outcome and published as versioned Art state. Success SHALL mean selection committed, never browser pixels displayed. The selected reference SHALL survive restart and catalog pruning. Explicit deletion SHALL clear that reference in the same transaction. A refused selection SHALL preserve the previous choice. Existing 2.0 commands and schema definitions SHALL retain their behavior.

#### Scenario: An older selected artwork leaves the recent page
- **WHEN** the selected artwork is older than the recent catalog limit and newer artworks arrive
- **THEN** its browser composition remains readable and selected without another provider call

#### Scenario: The selected artwork is deleted
- **WHEN** an explicit owner deletion succeeds for the selected artwork
- **THEN** the selection is cleared atomically and consumers receive the updated state

