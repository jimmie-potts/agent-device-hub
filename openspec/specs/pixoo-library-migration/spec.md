# pixoo-library-migration Specification

## Purpose
Carry the Pixoo service's library into the runtime's Pixoo module at the cutover ([Hub #931](https://github.com/jimmie-potts/agent-device-hub/issues/931)): an offline tool that reads the installed release's schema version 3 without changing it, copies its catalog, playlists, originals and renditions into the module's store, refuses what it cannot carry safely, and a verifier whose zero mismatches is the cutover's go. The installer (#935) runs it at the cutover (#840); this is source-verified on synthetic libraries and in a disposable run.

## Requirements

### Requirement: Offline migration of the installed Pixoo library

An offline tool, `node apps/runtime/dist/src/migrate-pixoo.js migrate --library <dir> --state-dir <dir> [--min-free-bytes <bytes>]`, SHALL carry the Pixoo service's library at the installed release's schema version 3 (divoom-app-upgrade `1b4115c`) into the Pixoo module's store in the runtime's state directory, and SHALL accept no other schema version. It SHALL insert every asset, rendition, playlist and item through SQLite into the module's SQLite file, `modules/pixoo.sqlite`, opened as the runtime opens it, at the installed schema that the library's own first three migrations create, and SHALL copy every original and rendition file that the catalog names into the module's private folder, `modules/pixoo/media/`, as new files private to their owner, never through a link. It SHALL then run the library's own forward migration on the destination and the library's own check of every copy against the hashes its catalog gives, SHALL run the database's last checkpoint and check that it finished, and SHALL close the database before it reports, with no log or journal left beside it. Sessions, their retained renditions, the playback checkpoint and pending cleanups SHALL start fresh and stay in the backup. Files that no catalog entry names SHALL NOT be copied. The report SHALL count the sessions, checkpoints, cleanup jobs and uncopied files it leaves in the backup. The tool SHALL NOT write the module's own tables, including its hosted checks, which the module makes after its first start. It SHALL never change the source library: it SHALL open the catalog read-only and immutable, hold the library's owner lock shared without writing, and open every file read-only without following a link.

#### Scenario: A synthetic library of the installed schema
- **WHEN** the tool migrates a synthetic library of schema version 3 with stills, a GIF, a JPEG, a GIF whose canvas is over 4,096 x 4,096 pixels, an asset with two renditions, three playlists (one empty, one naming a rendition twice), a session with the player's checkpoint, a pending cleanup with its orphaned original and a leftover staging folder
- **THEN** the destination's assets, renditions, playlists and items equal the source's, each playlist keeps its order and its references, every original and rendition file is byte-identical and private, the orphaned original and the staging folder are not copied, the session, checkpoint and cleanup tables are empty, the destination is at the library's current schema with no log beside it, and the report counts one session, one checkpoint, one cleanup, two files left in the backup and one large GIF original

#### Scenario: The module starts on the migrated store
- **WHEN** the Pixoo module starts on the destination
- **THEN** it serves one `pixoo-rendition/2.0` record per migrated rendition and the migrated playlists with their items in order, and a `media-start` of a migrated playlist plays it on the simulated Pixoo

#### Scenario: A rerun into a fresh destination
- **WHEN** the tool migrates the same library into a second fresh state directory
- **THEN** its report, with the digests of the carried rows and of the copied files, equals the first one's, and the two destinations hold the same files

#### Scenario: The source is never changed
- **WHEN** the tool has migrated and verified the library, refused it, failed on copies of it and been interrupted
- **THEN** every entry of the source library has the type, mode, size, modification time and content it had before, and no file was added beside it

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

### Requirement: Migration verifier

`node apps/runtime/dist/src/migrate-pixoo.js verify --library <dir> --state-dir <dir>` SHALL hold the library's owner lock and the runtime's lease, open the module's database read-only and immutable, create nothing, and compare the migration, as it was left before the runtime's first start, with the source. It SHALL count, each by kind: `database` for a database file that is missing, not a private regular file with one link, has a log or journal with content, is not at the library's current schema with exactly its tables beside the module's and the SDK's, has a catalog revision other than 0, or fails SQLite's checks; `assets`, `renditions`, `playlists` and `items` for each row missing, extra or different by ID; `leftInBackup` for each row in a table that starts fresh: the library's sessions, retained renditions, checkpoint and cleanups, and the module's and the SDK's own tables; `files` for each file the source catalog names whose copy is missing, not a private regular file with one link, or differs from the source's SHA-256, or whose source no longer matches its catalog; and `unexpected` for anything else in the module's folder or a directory there that is not private. It SHALL exit 0 only when every count is zero and 1 otherwise, and SHALL refuse with `destination-missing` a state directory with no module database.

#### Scenario: A clean migration
- **WHEN** the verifier checks a migration of the synthetic library
- **THEN** it reports `verified` with every count zero, the same digests as the migration's report and exit code 0

#### Scenario: A planted corruption
- **WHEN** a frame byte changes, an original is removed, a manifest is truncated, a copy is opened to others, a copy is replaced by a link, an extra file appears, a playlist is renamed, two items swap positions, an asset or a session row is added, the catalog revision changes, a module or SDK table holds rows, the database has a log with content or an extra table, or the database is missing
- **THEN** the verifier reports `mismatch` with exactly the matching counts and exits 1

### Requirement: Migration output

The tool SHALL write exactly one JSON line to standard output, with the schema `pixoo-migration/1.0`, its operation and its result: `migrated` with the counts of assets, renditions, playlists, items, originals, rendition files and bytes, the counts of sessions, checkpoints, cleanup jobs and files left in the backup, the count of GIF originals whose canvas is over 4,096 x 4,096 pixels, and the SHA-256 digests of the carried rows and of the copied files; `verified` or `mismatch` with the same counts and digests and each kind's mismatch count; or `refused` or `failed` with a code and fixed text. No line SHALL hold a path, an asset or playlist name, a title or a file's content.

#### Scenario: Counts, codes and hashes only
- **WHEN** the tool migrates and verifies a synthetic library whose names include a marker
- **THEN** neither line holds the marker, any name, the library's or the state directory's path, or a file path
