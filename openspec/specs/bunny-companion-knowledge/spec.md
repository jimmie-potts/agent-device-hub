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

### Requirement: Explicit latest Duck conversation selection
The owner SHALL explicitly select or clear one permitted conversation containing Reachy and MicroDuck for the Home widget. The selection SHALL survive reload/restart, remain separate from message storage and creation order, and confer no sharing or output authority. New conversations and imported archives SHALL NOT silently select or replace it.

#### Scenario: Select one exchange without aggregating private history
- **WHEN** the owner selects one Reachy–Duck exchange while other conversations exist
- **THEN** the widget clearly labels that selection and reads only its permitted records
- **AND** a missing or unrelated private conversation is refused, a stale selection write does not overwrite the current choice, and clearing returns to an unselected state

### Requirement: Read one latest meaning and separate history
The Home widget SHALL show exactly one latest remaining Duck message by the selected conversation's creation order, with speaker, original time, meaning type, provenance and truthful available delivery evidence. A View conversation link SHALL open bounded history separately with speaker/time labels and navigation back to Home. Neither surface SHALL generate speech, capture, graph execution or device commands.

#### Scenario: Latest meaning follows authoritative corrections and removals
- **WHEN** a newer Duck message arrives, Reachy replies, an older message is corrected, or the latest Duck message is removed
- **THEN** the card uses the newest remaining Duck message without letting a Reachy reply or correction reorder it
- **AND** removal falls back to the previous message with its original time/evidence or explicit empty, including after restart

#### Scenario: Meaning and output evidence stay distinct
- **WHEN** the selected record is literal, emotional-only, unknown, synthetic, or has unqualified delivery references
- **THEN** the card labels the distinction without inventing translation or claiming audio played or was heard
- **AND** history remains readable without Reachy hardware, voice or a running model

#### Scenario: Retained records remain displayable
- **WHEN** a retained message has a timestamp outside the browser's calendar range or long unbroken legacy text
- **THEN** the surface reports time unavailable without crashing, and the legacy text wraps within the narrow layout

#### Scenario: Private content is retired on invalidation or access loss
- **WHEN** selection or records change, a read fails or is denied, the connection is lost, or an older read finishes late
- **THEN** outdated content is hidden until a current permitted read succeeds, with unselected, empty, unavailable and stale states distinguishable
- **AND** no private content enters URLs, diagnostics or shared metadata and reconnect never replays an effect

#### Scenario: Metadata subscription fails while the dashboard stays connected
- **WHEN** the initial companion sync is refused or fails, or its later copy stops
- **THEN** Home and history hide private content, distinguish denied from unavailable, and offer an explicit refresh that starts a fresh sync without an output command

#### Scenario: Accessible Home and history
- **WHEN** the owner adds the card, opens history, pages through messages and returns Home using a keyboard or narrow viewport
- **THEN** the selection and messages remain readable, updates do not steal focus, and Home displays no inline transcript or reveal control
- **AND** history uses the owner's existing pagination and retention rules without a twenty-message cap or separate archive
