## ADDED Requirements

### Requirement: Bounded art placement preserves functional cards
Home SHALL offer banner, square and tall art presentation within bounded responsive geometry. An explicit owner placement SHALL reserve stable geometry independent of image arrival. Optional automatic art SHALL use only trailing free space and SHALL shrink or disappear when that space cannot fit it, without changing functional card order or geometry. Automatic placement SHALL NOT overwrite saved arrangements. Changes to automatic geometry SHALL wait while a pointer interaction, focused control or Home edit is active. Attention cards SHALL remain visible and unobscured.

#### Scenario: Art arrives during interaction
- **WHEN** artwork finishes loading while a functional control has focus or a pointer interaction is active
- **THEN** its geometry and focus remain unchanged, visible attention remains accessible and no device command is sent

#### Scenario: A screen has no free space
- **WHEN** the remaining screen area cannot fit optional automatic art
- **THEN** Home omits the optional art without overflow, overlap, saved-layout writes or functional-card movement

### Requirement: Explicit art layout controls persist with Home
Pin, dismiss, restore and format controls SHALL change only the core-owned Home arrangement through the existing revision-guarded save. Pin SHALL reserve the owner's selected art geometry. Layout dismissal SHALL remain distinct from negative art feedback and artwork deletion. Desktop and phone arrangements SHALL remain independent. Reset SHALL restore the default arrangement through the existing explicit edit flow. Existing arrangements without art metadata SHALL remain valid.

#### Scenario: Layout choices survive restart
- **WHEN** the owner pins or dismisses art and its save succeeds
- **THEN** reload, another browser and runtime restart show that saved choice, Restore remains available for dismissed art and no generation or device command occurred

#### Scenario: A layout save is uncertain or conflicting
- **WHEN** another browser changes the revision or a save loses its reply
- **THEN** the existing conflict or uncertainty controls preserve the owner's evidence, send no automatic retry and do not overwrite the other arrangement

#### Scenario: An older client omits optional art metadata
- **WHEN** a valid older save retains the art placement but omits its optional format and pin
- **THEN** the core preserves those existing options while applying unrelated placement changes
- **AND** explicit new options, removal and reset still take effect
