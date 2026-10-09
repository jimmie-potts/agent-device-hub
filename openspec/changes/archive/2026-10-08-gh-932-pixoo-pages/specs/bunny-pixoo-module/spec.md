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

#### Scenario: Saved renditions and frozen player session
- **WHEN** the user renders a different preview, selects a saved playlist and explicitly starts it
- **THEN** existing originals and renditions remain, the Player page reads its frozen session and estimated timing through a bounded authenticated content reference, and later saved playlist edits wait for an explicit restart with changes

#### Scenario: Player reads are passive
- **WHEN** a caller reads the player content reference or opens the Player page
- **THEN** it receives existing state, session and sample time within 256 KiB, no query is accepted, and no playback or device command is sent

#### Scenario: Inspect settings and explicitly control the display
- **WHEN** a caller opens the Pixoo settings page
- **THEN** the page shows the safe configuration projection and current device facts without a device command
- **AND** configuration changes use the runtime configuration file and restart, while explicit brightness and screen controls use the existing tracked commands

#### Scenario: Monitor details follow their owner
- **WHEN** a session title, cached preview or player detail changes while the small display summary remains equal
- **THEN** the owner advances the existing display record revision so the page refreshes its referenced details without polling or a second connection
- **AND** Monitor reads only copied session facts and cached pixels; dismissal acknowledges only the Pixoo consumer through the existing command

#### Scenario: Ordinary upload and staging cleanup
- **WHEN** a user uploads synthetic media larger than the JSON command limit and the import completes, fails or its accepted request is repeated
- **THEN** one original import is tracked, no duplicate import is sent, and every terminal or definitively refused upload releases its private staged input without changing the display

#### Scenario: Abandoned upload after restart
- **WHEN** Pixoo restarts with an abandoned uploader-owned hash file
- **THEN** unfinished commands are reported uncertain, the temporary file is removed, and no import or display command is replayed

## MODIFIED Requirements

### Requirement: Pixoo module and its configuration

The Pixoo SHALL run in the runtime as the module `pixoo`, created by `createPixooModule({transport})` with module API 1.3, from the package `@jimmie-potts/pixoo` under `modules/pixoo`, which imports only the SDK, the contracts package, its own files, Node built-ins and third-party packages. Its manifest's `configure` SHALL accept a section with `device` (a routing ID, a private IPv4 address, a profile the transport accepts, and an optional label, model and firmware), `hostedGif` (bind, port and origin), the starting `presentation` and `nowPlaying` settings, and `playback` (the playback record to follow), and SHALL name the device as the module's device. It SHALL refuse any other section with `invalid-request` and fixed text that repeats no value. A real transport SHALL accept only the observed device profiles and SHALL need `hostedGif` for the hosted profile; a simulated one SHALL also accept the simulator's profile. The module SHALL read no secret. `convertPixooSettings` SHALL turn the Pixoo service's `device.json`, `hosted-gif.json`, `presentation.json` and `now-playing.json` into a section the module accepts, with the Hub's device ID `pixoo-local` unless told another, or a refusal.

#### Scenario: A valid section
- **WHEN** the runtime admits a section naming device `pixoo-1` at a private address with an observed profile
- **THEN** the module is accepted with `pixoo-1` as its device, and without a section it is refused with `not-found`

#### Scenario: Sections the module refuses
- **WHEN** a section has a device ID with a space, a public or malformed address, an unknown profile, an unknown member, a hosted origin that is not http, a presentation or Now Playing setting of another version, or a malformed playback ID, or names the hosted profile without `hostedGif` for a real device
- **THEN** each is refused with `invalid-request`, and no refusal repeats a value from the section

#### Scenario: The service's settings converted
- **WHEN** the conversion reads a version 1 device file with the hosted profile, the hosted listener's file and the presentation and Now Playing files
- **THEN** it returns a section with device `pixoo-local` that the module accepts and that names no secret, and a device file of another version, a hosted profile without the listener or a device ID that is not a routing ID gives a refusal
