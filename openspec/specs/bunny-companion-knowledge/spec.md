# bunny-companion-knowledge Specification

## Purpose

Retain explicit private knowledge, persona identity and attributed conversation independently of a model or client, with current bounded context and additive recovery.

## Requirements

### Requirement: Explicit knowledge lifecycle
The companions owner SHALL retain titled knowledge with stable identity, current active state and inspectable history, independently of preferences. New explicit entries SHALL be active; inactive edits SHALL remain inactive.

#### Scenario: Owner manages and restarts knowledge
- **WHEN** an owner creates a synthetic person, relationship, event or stated routine, edits it, stops using it and restarts
- **THEN** IDs and history remain available while inactive and historical text are absent from normal retrieval and copied context until explicit reactivation

### Requirement: Curated personas and current context
The owner SHALL inspect stable bunny, reachy and microduck profiles and explicitly request a bounded versioned context document with current active knowledge/preferences and selected permitted conversation messages. Voice references SHALL remain independent of models. Data SHALL confer no authority or current location evidence.

#### Scenario: Context is selected and refreshed
- **WHEN** a selected message is corrected or removed, or knowledge is deactivated, before the next context read
- **THEN** the read uses current records, excludes removed/inactive content and other personas' private conversations, and returns explicit denied/unavailable results rather than invented recall
- **AND** no whole history, persistent context cache or automatic graph injection is used

### Requirement: Attributed authoritative conversation
Messages SHALL retain stable IDs, explicit or unknown recipients, meaning/provenance, immutable creation order, revisions and supplied delivery references. Legacy records SHALL preserve known evidence without fabricating missing meaning/audience/delivery. Shared exchanges SHALL be stored once for explicit participants. Reads SHALL never render or replay.

#### Scenario: Correction and latest Duck removal
- **WHEN** the owner corrects an older message then deletes the newest Duck message in a synthetic shared exchange
- **THEN** correction does not reorder it, and latest returns the newest remaining Duck message with its original time/evidence or explicit empty
- **AND** English Duck text is labelled intended meaning, unknown quacks gain no invented translation, fiction never becomes knowledge, and fake audio fixtures refuse English

#### Scenario: An unfinished task protects its messages
- **WHEN** correction or removal, including an imported removal, affects an unfinished assistant task
- **THEN** the whole operation is refused until the task finishes or is cancelled, without rewriting checkpoints or replaying calls

### Requirement: Additive private recovery
The owner SHALL export/import a closed versioned private archive atomically. Existing entries, history, active state, local voice selections and message corrections SHALL win. Missing knowledge/preferences SHALL arrive inactive, and imported messages SHALL remain historical and require explicit context selection. Known removals SHALL defeat imported content and exports SHALL contain removal metadata without deleted text.

#### Scenario: Repeated old and current archives
- **WHEN** an archive is imported into the same or an empty store, repeated, or followed by an older archive
- **THEN** existing records remain unchanged, missing entries are inactive, known message removals persist, and incompatible identity/order refuses the whole file
- **AND** fresh recovery documents that an old file alone cannot know later deletions

#### Scenario: Refused or interrupted changes
- **WHEN** validation, version, revision, capacity, full-disk or transaction checks fail
- **THEN** there is no partial change, history truncation or successful receipt; committed writes awaiting publication remain committed

### Requirement: Source portability and management
The existing authenticated dashboard SHALL expose knowledge, persona inspection, bounded history, explicit context copy and private files with keyboard, narrow layout, read-only and disconnected behavior. Shared state, commands, outcomes and diagnostics SHALL exclude prose. Two fake adapters and a test-only replacement client SHALL consume the public private-content contract.

#### Scenario: A replacement client reads after restart
- **WHEN** fixed synthetic questions use either fake adapter and an authenticated replacement client before and after restart
- **THEN** IDs, current permitted knowledge, inactivity, persona rules, corrections and removals agree without internal database access, paid calls, audio or device effects
- **AND** existing preference, synthetic assistant and Reachy behavior remains supported
