## ADDED Requirements

### Requirement: Pixoo library and player pages in the shared dashboard
The Pixoo module SHALL contribute its existing library, playlist, player, preview, Monitor and settings views to the shared dashboard through the trusted frontend contract. Reads and commands SHALL use authenticated runtime interfaces and the existing Pixoo owner, preserving Monitor/Media semantics, consumer-only dismissal, revision checks and tracked outcomes. Catalog pages SHALL stay within 256 KiB and previews SHALL load by reference. Normal media addition SHALL use bounded authenticated staging and the existing import outcome cleanup; fresh state SHALL require no imported legacy media or playlists. Read-only callers SHALL have no mutation controls and SHALL be refused by the command boundary. Opening pages, reconnecting and reloading SHALL replay no media, effect or command.

#### Scenario: Explicit playlist edit through the real command path
- **WHEN** a control-authorized user opens a synthetic playlist, changes its draft name and explicitly saves it
- **THEN** opening and drafting leave the library and device unchanged, exactly one revision-checked tracked command is sent on save, and the resulting owner state confirms the name separately from acceptance or uncertainty

#### Scenario: Read-only editor and no replay
- **WHEN** a read-only user opens the editor and attempts a forged mutation, or a page reloads after a lost command reply
- **THEN** the mutation is refused without effects and no command is resent automatically

#### Scenario: Bounded catalog and referenced preview
- **WHEN** a library exceeds one 256 KiB catalog page and the user opens it and a preview
- **THEN** the catalog is split into bounded pages and the selected preview loads through its authenticated reference without exposing a private path

#### Scenario: Existing views remain usable
- **WHEN** the library, playlists, player, preview, Monitor and settings views are exercised with fresh synthetic media and a simulated Pixoo
- **THEN** their existing supported flows work through the runtime, keyboard and accessibility checks pass, and device effects occur only after explicit authorized commands

#### Scenario: Ordinary upload and staging cleanup
- **WHEN** a user uploads synthetic media larger than the JSON command limit and the import completes, fails or its accepted request is repeated
- **THEN** one original import is tracked, no duplicate import is sent, and every terminal or definitively refused upload releases its private staged input without changing the display

#### Scenario: Abandoned upload after restart
- **WHEN** Pixoo restarts with an abandoned uploader-owned hash file
- **THEN** unfinished commands are reported uncertain, the temporary file is removed, and no import or display command is replayed
