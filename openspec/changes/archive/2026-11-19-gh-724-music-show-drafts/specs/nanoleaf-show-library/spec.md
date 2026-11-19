## ADDED Requirements

### Requirement: Explicit AI authoring for music shows

The show library SHALL let an authenticated controller explicitly request one Claude draft using a style request, the current Music title and artist, and either qualified derived analysis or a selected generic sequence. The request SHALL send no audio, scoped item identifiers, device details or credentials in its model input.

#### Scenario: Qualified measurements bound a draft

- **WHEN** the controller selects the measured excerpt and requests generation
- **THEN** a generated plan is available for editing only if each cue uses supported effects and valid measured span boundaries
- **AND** the editor identifies the result as a measured excerpt and displays the provider route and accounted cost

#### Scenario: Missing or inadequate measurement

- **WHEN** the selected measured excerpt cannot be qualified
- **THEN** the request is refused without dispatch
- **AND** the controller can explicitly request a generic sequence against fresh title and artist metadata even without a position reading
- **AND** a generic result is labeled as having no measured alignment

#### Scenario: Invalid or interrupted result

- **WHEN** Claude returns malformed or unsupported content, a sent call becomes uncertain, or the controller requests cancellation
- **THEN** no earlier edits, saved shows or favorites are changed
- **AND** the provider is not called again for that request

#### Scenario: Separate Music allowance

- **WHEN** a request would exceed the Music ledger's available USD 3 daily or USD 20 monthly allowance
- **THEN** it is refused before dispatch
- **AND** admission reserves against the higher supported regional rate
- **AND** an uncertain sent attempt keeps its exposure charged against the Music allowance

#### Scenario: Reopen a paid draft

- **WHEN** the browser reloads after a successful generation
- **THEN** the operator can explicitly reopen the latest successful draft
- **AND** the read sends no provider request

#### Scenario: Recover a transient settlement failure

- **WHEN** the owner has a result and its local settlement write temporarily fails
- **THEN** it retries only the local transaction, keeping the original spending record and attempt identity
- **AND** a recovered settlement unblocks new explicit requests

#### Scenario: Preview, save and play

- **WHEN** the controller receives and edits a generated preview
- **THEN** the preview creates no saved show or device command
- **AND** only an explicit save creates an immutable revision with generation provenance
- **AND** separately authorized playback uses that saved revision without accessing Claude
