## ADDED Requirements

### Requirement: Offline migration of the Nanoleaf bridge's state

An offline tool, `node apps/runtime/dist/src/migrate-nanoleaf.js migrate --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>`, SHALL carry the codex-nanoleaf bridge's state directory, at model version 4 as the installed release (codex-nanoleaf `c711e18`) keeps it or as the pre-change Linux database without device keys keeps it, into the Nanoleaf module's store in the runtime's state directory. For each device the bridge's registry names, it SHALL insert through SQLite, into the module's SQLite file `modules/nanoleaf.sqlite`, opened as the runtime opens it and created with the module's own schema code, the project map and colors (`projects`), the palette (`palette`), each element's project and halves (`line_prefs`), the map settings (`map_settings`), a pending wall edit (`map_pending`), the favorites (`animation_favorites`) and each device's mode, mode revisions and native power and brightness overrides (`meta`), each value with its storage class, a pre-change row as the Lines' (`wall`). It SHALL write the layout of the registered devices, as a version 2 `layout.json`, and each registered device's scene file into the module's private folder `modules/nanoleaf/`, as new files private to their owner, never through a link, and SHALL close the database before it reports. Tasks and what follows them, reservations, comets, Locate, display caches, task and effect epochs, holds and failures, the controller ledger, the integration API's requests, the legacy task backup, the shared-input configuration's `bindings`, and the rows, layout entries and scene files of a device the registry no longer names SHALL start fresh and stay only in the backup, and SHALL be counted. The destination's `shared_input` row SHALL be the fresh one, with the stored source `'legacy'`, which the module reads as not selected. The tool SHALL never change the source: it SHALL open `status.sqlite` read-only and hold a read transaction on it, hold the bridge's worker, registry and layout lock files shared without writing, and open every file read-only without following a link.

#### Scenario: The linux-state-v4 fixture
- **WHEN** the tool migrates the `linux-state-v4` fixture, the pre-change Linux database with its layout and scene files
- **THEN** the destination holds its two projects with their colors, its three element preferences, its map settings and its pending wall edit as the Lines', the mode with its revisions, the fifteen Lines with their zones and positions in a version 2 layout and the scene file; its sessions, activity, reservations, comets, Locate, display cache, epochs and ledger are left behind and counted; the `shared_input` row reads as not selected; and the verifier reports zero mismatches

#### Scenario: The installed shape with two devices
- **WHEN** the tool migrates a synthetic state of the installed shape with the Lines and NL22 Light Panels, a palette, favorites, a selected shared input with `bindings` and a legacy task backup, and a device the registry no longer names
- **THEN** both devices' preferences, modes, overrides, layouts and scenes, the palette and the favorites are carried; the `bindings`, the legacy backup, the shared-input configuration and the removed device's rows, `meta` value and scene file are not; and a second migration of the same source gives the same report and digests

#### Scenario: The module starts on the migrated store
- **WHEN** the Nanoleaf module starts on the migrated store with the converted section
- **THEN** its wall view shows the migrated settings, palette, project colors and element projects, its device records show each device's carried mode and override, its animation options list the migrated favorites, and its first sync selects shared input

#### Scenario: The source is never changed
- **WHEN** the tool has migrated and verified a state, converted it, and refused one with a journal to roll back
- **THEN** every entry of the source has the type, mode, size, modification time and content it had before, and no file was added beside it

### Requirement: Device addresses and tokens move into the module's section

`migrate` SHALL convert the bridge's registry into the module's section of the runtime's configuration file: each registered device with its ID, kind and private IPv4 address, naming the secret `<device>-token`, the Lines first; the shared-input configuration's qualified sources, without its `bindings` and the 1.x feed's endpoint and token files; and, when `config.json` names them, Codex Desktop's metadata paths. It SHALL write each device's token, alone and without a line break, to a new file `nanoleaf-<device>-token`, mode 600, in `--secrets-dir`, a private directory it creates when missing, and the section, naming those files, to `--section`, a new private file in a private directory, for the installer to put under `modules.nanoleaf`. The section SHALL be one the module's own `configure` accepts. No token SHALL appear in the section, the module's store or folder, an output line or an error. An address change SHALL be a one-line edit of the device's `address` in the section, with which the device keeps its ID and its preferences.

#### Scenario: The converted section
- **WHEN** the tool converts a state with the Lines and NL22 Light Panels and Codex metadata paths, and one whose registry predates the device list
- **THEN** the section names both devices with their addresses and secrets, the qualified sources without `bindings`, and the metadata paths; the older one gives the Lines with the top-level address and token; the module's `configure` accepts each; and the tokens are only in the secret files

#### Scenario: An address change
- **WHEN** the section's address of the Lines is changed and the module starts on the migrated store
- **THEN** the module reaches the Lines at the new address only, and its wall view keeps their settings and palette

#### Scenario: A state the conversion refuses
- **WHEN** the bridge never configured shared input, or a device has a public address, no token or a token with a space, or `config.json` names a relative metadata path or a title index without its catalog, or qualified sources the module refuses
- **THEN** the conversion is refused with `source-not-configured` or `source-config` and fixed text

### Requirement: Migration refusals and failures

The tool SHALL refuse with exit code 3, before it writes anything, and name the refusal's code with fixed text: `usage` is exit code 2 instead, for malformed or relative arguments; `runtime-running` while a runtime, or another tool, holds the state directory's lease, which the tool takes with `holdRuntimeLease` and holds for as long as it runs; `secrets-dir-refused` or `section-dir-refused` for a directory that is not private, is inside a Git checkout, is on `/mnt` or is reached through a link; `destination-not-empty` when the module already has a database, a log, a journal or a non-empty folder, or a secret file or the section already exists; `source-missing` for a directory without `status.sqlite` or `config.json`; `source-in-use` while a bridge worker, enrollment or another writer holds the source; `source-not-clean` for a `status.sqlite` with a journal to roll back; `source-schema` for another model version, WAL mode, or a carried table with another column; `source-corrupt` for a database that fails SQLite's check or a damaged, oversized or linked JSON file; `source-config` for a malformed registry; and `source-device-id` for a registered device ID that is not a routing ID. Once it has begun to write, a failure SHALL exit with code 4, name its code (`disk-short` for a full disk), and SHALL remove the module's database files and folder and each file it created, saying whether it did. While the tool runs, a runtime that starts on the state directory SHALL fail to take the lease, and a bridge worker that starts SHALL fail to take its lock.

#### Scenario: A running runtime
- **WHEN** a runtime runs on the state directory and the tool is asked to migrate or verify
- **THEN** each is refused `runtime-running` with exit code 3 and nothing is written, and once the runtime stops, the migration runs

#### Scenario: A runtime started during a migration
- **WHEN** a runtime starts while the tool holds the lease
- **THEN** its core fails to take the lease and the runtime exits 1 with `core-failed`

#### Scenario: A destination that already has files
- **WHEN** the module already has a migrated database, its folder holds a file, a secret file is already there or the section is
- **THEN** the migration is refused `destination-not-empty` before writing, and an earlier migration still verifies

#### Scenario: A source the tool cannot carry
- **WHEN** the source has no `status.sqlite` or `config.json`, is at model version 3, has a carried table with an added column, is in WAL mode, has a damaged layout or scene file, a linked `config.json`, a malformed registry or a device ID that is not a routing ID, a running worker or enrollment holds its lock, or a killed writer left a journal to roll back
- **THEN** each is refused with its code and nothing is written, and while the tool reads the source, a worker cannot take its lock and no bridge process commits to `status.sqlite`

#### Scenario: A failure after writing began
- **WHEN** another process makes a secret file between the tool's checks and its write
- **THEN** the migration fails with exit code 4, the module's database and folder and the section are removed, and the other process's file is left as it was

### Requirement: Migration verifier

`node apps/runtime/dist/src/migrate-nanoleaf.js verify --source <dir> --state-dir <dir> --secrets-dir <dir> --section <file>` SHALL hold the runtime's lease and the bridge's locks, open the module's database read-only and immutable, and compare the migration with the source. `--section` SHALL name the section file `migrate` wrote or the runtime's configuration file holding it under `modules.nanoleaf`. It SHALL count, each by kind: `database` for a database file that is missing, not a private regular file with one link, has a log or journal with content, is not the module's schema or fails SQLite's check; `projects`, `palette`, `elements`, `mapSettings`, `pendingEdits`, `favorites` and `deviceState` for each carried row missing, extra or different, with its storage class, by its key; `startFresh` for each row of a table that starts fresh, each `meta` value that is neither carried nor the schema's, and a `shared_input` row other than the fresh one; `layout` and `scenes` for each file missing, different from the source or not a private regular file with one link; `unexpected` for anything else in the module's folder or a folder that is not private; `configuration` for each member of the section that differs from the conversion, each device on its own; and `secrets` for each secret file the runtime's own reader refuses or that does not hold the device's token. It SHALL exit 0 only when every count is zero and 1 otherwise, and SHALL refuse with `destination-missing` a state directory with no module database.

#### Scenario: A clean migration
- **WHEN** the verifier checks a migration of the fixture or the synthetic state, with the section file or with the configuration file that holds it
- **THEN** it reports `verified` with every count zero, the same digests as the migration's report and exit code 0

#### Scenario: A planted corruption
- **WHEN** a palette color, a project, a Line's halves, a rotation, the pending edit, a favorite's name or a mode changes, a project is added, an epoch, a task or a selected shared input appears, the database gains a table or is opened to others or is missing, the layout is edited, a scene file is missing, opened to others or linked, an extra file appears, the folder is opened to others, a secret file holds another token or the section names another address
- **THEN** the verifier reports `mismatch` with exactly the matching counts, never the token, and exits 1

### Requirement: Migration output

The tool SHALL write exactly one JSON line to standard output, with the schema `nanoleaf-migration/1.0`, its operation and its result: `migrated` with the counts of devices, projects, palette colors, element preferences, map settings, pending edits, favorites, device state values, layouts, scenes, qualified sources, metadata paths and secrets, the counts left in the backup, and the SHA-256 digests of the carried rows, of the written files and of the section; `verified` or `mismatch` with the same counts and digests and each kind's mismatch count; or `refused` or `failed` with a code and fixed text. No line SHALL hold a token, an address, a path, a project, favorite, scene or task name, or a file's content.

#### Scenario: Counts, codes and hashes only
- **WHEN** the tool migrates, verifies and refuses a synthetic state whose names carry a marker
- **THEN** no line holds the marker, the synthetic token, an address, the source's or the destination's path or a device ID, and only the secret files hold the token

### Requirement: A disposable run on a migrated Nanoleaf state

The runtime verification adapter SHALL offer the run scenario `nanoleaf-migrated`: its seed SHALL write a synthetic bridge state of the installed shape, with the simulated controllers' addresses and token and the run's synthetic Claude Code hook as its qualified source, to `<data>/nanoleaf-bridge`, run the migration's `migrate` into the run's state directory with its secrets in `<data>/config/secrets` and its section in `<data>/migration/`, put that section into the run's configuration file in place of the simulated one, run `verify` against that file, as the installer will at the cutover, keep each line in `<data>/migration/`, and fail the start unless both exit 0. The run SHALL then start the shipped runtime on that state directory and configuration, so a reviewer reads the migrated preferences through the gateway and runs the tool by hand against the run's bridge state.

#### Scenario: The shipped runtime on a migrated state
- **WHEN** a run starts with `nanoleaf-migrated`
- **THEN** both kept lines report zero mismatches, the Nanoleaf module is running, the gateway's `nanoleaf-wall` records hold the migrated settings, palette, project colors and modes and its `nanoleaf-animations` record the migrated favorites, no record holds the token, and the tool asked to verify the run's state directory while the runtime runs is refused `runtime-running`
