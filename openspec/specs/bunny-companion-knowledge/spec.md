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
The owner SHALL inspect stable bunny, reachy and microduck profiles and explicitly request a bounded versioned context document with current active knowledge/preferences and selected permitted conversation messages. Voice references SHALL remain independent of models. Data SHALL confer no authority or current location evidence. The owner SHALL be able to turn the knowledge notes on or off for each companion's model context, off until the owner turns them on, and the profiles document SHALL name the companions whose context holds them ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). The Companion knowledge page SHALL preview a companion's model context from the assistant's context builder, as the assistant-tasks capability specifies, apart from the context document for copying.

#### Scenario: Context is selected and refreshed
- **WHEN** a selected message is corrected or removed, or knowledge is deactivated, before the next context read
- **THEN** the read uses current records, excludes removed/inactive content and other personas' private conversations, and returns explicit denied/unavailable results rather than invented recall
- **AND** no whole history or persistent context cache is used; knowledge entries reach a companion's model prompt only while the owner has turned them on for it, and conversation messages only as its own conversation's recent section, as the assistant-tasks capability specifies

#### Scenario: Knowledge switch per companion
- **WHEN** the owner turns knowledge notes on for B.U.N.N.Y. from the Companion knowledge page and previews its model context
- **THEN** the profiles document names B.U.N.N.Y. alone, the preview shows the knowledge notes section with what it sends, and Reachy's context keeps it off

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
The owner SHALL export/import a closed versioned private archive atomically. Existing entries, history, active state, local voice selections and message corrections SHALL win. Missing knowledge/preferences SHALL arrive inactive, and imported messages SHALL remain historical and require explicit context selection. Known removals SHALL defeat imported content and exports SHALL contain removal metadata without deleted text. An archive MAY hold several conversations of one profile, its current one and earlier ones; an export SHALL list each profile's current conversation after its earlier ones, an import SHALL NOT move a profile's current conversation, and a profile without one SHALL take the archive's last conversation of that profile ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). Imported messages SHALL stay out of a companion's model context.

#### Scenario: Repeated old and current archives
- **WHEN** an archive is imported into the same or an empty store, repeated, or followed by an older archive
- **THEN** existing records remain unchanged, missing entries are inactive, known message removals persist, and incompatible identity/order refuses the whole file
- **AND** fresh recovery documents that an old file alone cannot know later deletions

#### Scenario: Refused or interrupted changes
- **WHEN** validation, version, revision, capacity, full-disk or transaction checks fail
- **THEN** there is no partial change, history truncation or successful receipt; committed writes awaiting publication remain committed

#### Scenario: Earlier conversations of a profile
- **WHEN** an archive holding a profile's earlier and current conversations is imported into an empty store and into its own store
- **THEN** both are accepted, the earlier conversation is readable in each, and the current conversation is the archive's current one in the empty store and unchanged in its own, and no imported message reaches a model call

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

#### Scenario: Keyboard and narrow Home and history
- **WHEN** the owner adds the card, opens history, pages through messages and returns Home using a keyboard or narrow viewport
- **THEN** the selection and messages remain readable, updates do not steal focus, and Home displays no inline transcript or reveal control
- **AND** history uses the owner's existing pagination and retention rules without a twenty-message cap or separate archive

### Requirement: Knowledge commands are checked against what they change
Each knowledge command SHALL name the assistant revision the page read and SHALL be refused as a revision conflict only when a scope or conversation it changes changed after that revision, or when the revision is ahead of the assistant's; no other state, a running conversation's steps included, SHALL make it stale. Knowledge entry changes (`create`, `edit`, `import`, `set-active`), `set-voice`, `fixture` and `import-archive` SHALL change the library scope; `select-duck-conversation` SHALL change the Duck widget scope; `correct-message` and `delete-message` SHALL change the message's conversation, using that conversation's change revision; `import-archive` SHALL also change each conversation it adds to: a conversation or profile binding not yet saved, a removal not yet known, or a message neither saved nor removed. An accepted command SHALL record what it changed at the revision it publishes, in the same transaction on the module's one SDK-owned SQLite connection, with no transaction across an await. Each start SHALL count both scopes as changed at the assistant's current revision. A refusal SHALL have no effect and SHALL NOT be retried. Enable and disable SHALL keep the assistant-wide revision, and no wire field SHALL be added.

#### Scenario: A running conversation's step
- **WHEN** the owner reads the page, a running conversation then takes a step, and the owner sends a library, voice, Duck widget, correction, removal, fixture or archive command naming the revision read
- **THEN** the command is accepted when nothing it changes changed after that revision, while a disable naming the same revision is refused as a revision conflict

#### Scenario: A change in its own scope
- **WHEN** two commands of one scope name the same revision, such as a create and then an edit or a voice, two Duck selections, or two corrections in one conversation
- **THEN** the first is accepted and the second is refused as a revision conflict, while a command of another scope naming that revision is accepted

#### Scenario: An archive that adds to a changed conversation
- **WHEN** an archive import adds a message to a conversation that changed after the revision it names
- **THEN** the import is refused as a revision conflict with no partial change, and an archive whose records are all present, a running conversation's included, is accepted

#### Scenario: A revision not yet reached
- **WHEN** a knowledge command names a revision ahead of the assistant's
- **THEN** it is refused as a revision conflict in every scope

#### Scenario: A command from before a restart
- **WHEN** the runtime restarts and a library, Duck widget or companion exchange command names a revision older than the assistant's revision at start
- **THEN** it is refused as a revision conflict, and the same command naming the revision at start is accepted
