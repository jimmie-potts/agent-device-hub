## ADDED Requirements

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
