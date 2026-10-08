## MODIFIED Requirements

### Requirement: Migration refusals and failures

The tool SHALL refuse with exit code 3, before it writes any of the module's data, its secrets or its section, and name the refusal's code with fixed text. It SHALL check its arguments, its output directories, the destination with its `modules/` and `modules/nanoleaf/` folders, and the source before it creates anything, so every refusal before the lease creates nothing; the lease creates the state directory, `modules/` and the lease's empty lock file, as a runtime's start does, and the destination and its folders are checked again under it. The codes: `usage` is exit code 2 instead, for malformed or relative arguments; `runtime-running` while a runtime, or another tool, holds the state directory's lease, which the tool takes with `holdRuntimeLease` and holds for as long as it runs; `secrets-dir-refused` or `section-dir-refused` for a directory that is not private, is inside a Git checkout, is on `/mnt` or is reached through a link; `destination-not-empty` when `modules/nanoleaf.sqlite` or its `-wal`, `-shm` or `-journal` file, a non-empty `modules/nanoleaf/` folder, a `nanoleaf-<device>-token` file in the secrets directory or the section file already exists; `module-folder-not-private` for a `modules/` or `modules/nanoleaf/` folder that is a link, belongs to another user or that others may open, as the Pixoo library migration names it; `source-missing` for a missing source directory, `status.sqlite` or `config.json`; `source-in-use` while a bridge worker, enrollment or another writer holds the source; `source-not-clean` for a `status.sqlite` with a journal to roll back; `source-schema` for another model version, WAL mode, or a carried table with another column; `source-corrupt` for a database that fails SQLite's check, a damaged, oversized or linked JSON file, or a linked lock file; `source-config` for a malformed registry; `paths-overlap` for a state directory, secrets directory or section folder inside the source directory, or the source inside one of them; and `source-device-id` for a registered device ID that is not a routing ID. Before it closes the module's database, it SHALL checkpoint the log into the file and truncate it, so a full disk there is a failure rather than a log that the close keeps without an error; a log or journal with content beside the file after the close SHALL fail it with `destination-not-clean`. Its writes SHALL run one after another, so none is still running when a failure removes what was written. A first SIGINT or SIGTERM SHALL stop it: before it writes, as a refusal with `interrupted`; once it has written, at its next stage, as a failure with `interrupted` that removes the module's database with its log and journal, its folder and every file it wrote, writes the one `failed` line and exits 4. Once it has begun to write, a failure SHALL exit with code 4, name its code (`disk-short` for a full disk anywhere, never a source's code), and SHALL remove the module's database files and folder and each file it created, saying whether it did. While the tool runs, a runtime that starts on the state directory SHALL fail to take the lease, and a bridge worker that starts SHALL fail to take its lock.

#### Scenario: A running runtime
- **WHEN** a runtime runs on the state directory and the tool is asked to migrate or verify
- **THEN** each is refused `runtime-running` with exit code 3 and none of the module's data, secrets or section is written, and once the runtime stops, the migration runs

#### Scenario: A runtime started during a migration
- **WHEN** a runtime starts while the tool holds the lease
- **THEN** its core fails to take the lease and the runtime exits 1 with `core-failed`

#### Scenario: A destination that already has files
- **WHEN** the module already has a migrated database, its folder holds a file, a secret file is already there or the section is
- **THEN** the migration is refused `destination-not-empty` before it creates anything, and an earlier migration still verifies

#### Scenario: A module folder that is not private
- **WHEN** `modules/` or `modules/nanoleaf/` already exists in the state directory and others may open it, or it is a link
- **THEN** the migration is refused `module-folder-not-private` with exit code 3 before it takes the lease, no module database, lease file, secrets directory or section is created, through the link or otherwise, and the folder is left as it was

#### Scenario: Refusals create nothing
- **WHEN** the arguments, an output directory, the destination or the source is refused, a destination lies inside the source or the source inside a destination, or a signal comes while the tool reads the source
- **THEN** no state directory, `modules/` folder, lease file or secrets directory is created

#### Scenario: A source the tool cannot carry
- **WHEN** the source has no `status.sqlite` or `config.json`, is at model version 3, has a carried table with an added column, is in WAL mode, has a damaged layout or scene file, a linked `config.json` or worker lock, a malformed registry or a device ID that is not a routing ID, a running worker or enrollment holds its lock, or a killed writer left a journal to roll back
- **THEN** each is refused with its code and nothing is created, and while the tool reads the source, a worker cannot take its lock and no bridge process commits to `status.sqlite`

#### Scenario: A failure after writing began
- **WHEN** another process makes a secret file between the tool's checks and its write
- **THEN** the migration fails with exit code 4, the module's database and folder and the section are removed, and the other process's file is left as it was

#### Scenario: A full disk
- **WHEN** the disk, a real tmpfs, fills before the tool's final checkpoint, before its secret files or before it starts
- **THEN** the migration ends with `disk-short`, nothing of the destination is left, and with room again the same source migrates and verifies

#### Scenario: A log left after the close
- **WHEN** a log with content is beside the module's database after the tool closed it
- **THEN** the migration fails with `destination-not-clean` and exit code 4, and removes what it wrote

#### Scenario: A signal
- **WHEN** a signal stops the tool before it writes, or at any stage after it has begun to write, a real SIGINT to the running tool while its log holds every row and a real SIGTERM after it wrote the secret files among them
- **THEN** it is refused with `interrupted` and creates nothing, or fails with `interrupted` and exit code 4 and removes what it wrote; the entry point stops listening after the first signal, so a second one stops the process at once
