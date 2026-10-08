## MODIFIED Requirements

### Requirement: Migration refusals and failures

The tool SHALL refuse with exit code 3 and create nothing: it SHALL check the source library, the state directory, the module's files and the free space before it makes anything, and SHALL name the refusal's code with fixed text. `usage` is exit code 2 instead, for malformed arguments. The refusals are `runtime-running` while a runtime, or another tool, holds the state directory's lease; `lease-unavailable` for a lease file that is not a regular file private to the user; `disk-short` when the free space is less than each file it copies and each folder it makes in whole blocks of the file system, plus twice the source catalog's size, plus `--min-free-bytes` (256 MiB by default); `destination-not-empty` when the module already has a database, a log, a journal or a non-empty folder, with every path the tool creates named in its text; `module-folder-not-private` for a `modules` folder or module folder that is a link, belongs to another user or that others may open; the state directory's `state-dir-*` codes; `source-missing` for a library path that is missing, is not a folder or holds no catalog; `source-in-use` while the Pixoo service holds the library's owner lock; `source-not-clean` for a catalog with a non-empty log or a journal, or a library without its owner lock file; `source-schema` for another application ID, user version or set of migrations, or tables, indexes or triggers that differ from the installed schema's; `source-corrupt` for a catalog that fails SQLite's checks or names a file that is missing, a link, too large or not a regular file; and `interrupted` for SIGINT or SIGTERM before it writes. Once every check has passed, `migrate` SHALL create the state directory and the runtime's lease file when they are missing and check the module's files again under the lease. Once it has begun to write, a failure SHALL exit with code 4 and name its code: `source-corrupt` when the library's own check refuses a copy, `disk-short` when the file system or the database fills up at any step, `destination-not-clean` when a log or journal with content is left beside the database after its close, and `interrupted` for SIGINT or SIGTERM. Before it reports a failure, every copy under way SHALL have finished and none SHALL start; it SHALL then remove the module's database, log, journal and folder, saying whether it did, and write exactly one line. While the tool runs, a runtime that starts on the state directory SHALL fail to take the lease, and the Pixoo service SHALL fail to open its library.

#### Scenario: A running runtime
- **WHEN** a runtime runs on the state directory and the tool is asked to migrate or verify
- **THEN** each is refused `runtime-running` with exit code 3 and the module has no files, and once the runtime stops, the migration runs

#### Scenario: A runtime started during a migration
- **WHEN** a runtime starts while the tool holds the lease
- **THEN** its core fails to take the lease and the runtime exits 1 with `core-failed`

#### Scenario: A short disk
- **WHEN** the free space is less than the library needs in whole blocks plus the space to keep free, as when it holds only the files' bytes, or `--min-free-bytes` is larger than the file system's free space
- **THEN** the migration is refused `disk-short` with exit code 3, and no state directory or folder is created

#### Scenario: A real full disk
- **WHEN** the tool migrates past the free-space check onto a private tmpfs of each size from 100 KiB to 600 KiB, so the disk fills at the installed schema, the rows, a copy, the forward migration or the last checkpoint
- **THEN** each migration either reports `migrated` and verifies with no log left, or fails `disk-short` with exit code 4, `removed`, and no module file left

#### Scenario: A full database at each step
- **WHEN** the module's database may grow to only so many pages, from 1 to 40
- **THEN** each migration either succeeds or fails `disk-short`, and the limits reach the installed schema, the rows and the forward migration

#### Scenario: A failure or an interrupt mid-copy
- **WHEN** the ninth file the tool reads fails, or the operator sends SIGINT or SIGTERM while the tool writes
- **THEN** no file is written after the migration fails, the line is the one `failed` line with `source-corrupt` or `interrupted` and `removed`, the tool exits 4, and only the runtime's lease file is left in `modules/`

#### Scenario: A log left after the close
- **WHEN** the database's close leaves a log with content beside it
- **THEN** the migration fails `destination-not-clean` with exit code 4 and removes the database and its log

#### Scenario: Module folders others may open
- **WHEN** an empty `modules/pixoo/` or `modules/` has mode 755
- **THEN** the migration is refused `module-folder-not-private` with exit code 3, creates no database and leaves the folder as it was

#### Scenario: A destination that already has files
- **WHEN** the module already has a migrated database, or its folder holds a file
- **THEN** the migration is refused `destination-not-empty`, and an earlier migration still verifies

#### Scenario: A source the tool cannot carry
- **WHEN** the library directory has no catalog, the library path is a file or missing, the Pixoo service holds it, its catalog's log holds commits, it has no owner lock file, its application ID or user version is not the installed release's, it is at schema version 4, a table has an added column, a frame is missing, or an original is a link
- **THEN** each is refused with its code, and the running migration, conversely, keeps the Pixoo service from opening the library

#### Scenario: A file that does not match its catalog
- **WHEN** a frame's bytes or a manifest no longer match the catalog
- **THEN** the migration fails `source-corrupt` with exit code 4, the module's database and folder are removed, and a migration of the intact library into the same state directory then succeeds
