## ADDED Requirements

### Requirement: Offline migration of the installed Pixoo library

An offline tool, `node apps/runtime/dist/src/migrate-pixoo.js migrate --library <dir> --state-dir <dir> [--min-free-bytes <bytes>]`, SHALL carry the Pixoo service's library at the installed release's schema version 3 (divoom-app-upgrade `1b4115c`) into the Pixoo module's store in the runtime's state directory, and SHALL accept no other schema version. It SHALL insert every asset, rendition, playlist and item through SQLite into the module's SQLite file, `modules/pixoo.sqlite`, opened as the runtime opens it, at the installed schema that the library's own first three migrations create, and SHALL copy every original and rendition file that the catalog names into the module's private folder, `modules/pixoo/media/`, as new files private to their owner, never through a link. It SHALL then run the library's own forward migration on the destination and the library's own check of every copy against the hashes its catalog gives, and SHALL close the database before it reports. Sessions, their retained renditions, the playback checkpoint and pending cleanups SHALL start fresh and stay in the backup, and SHALL be counted. Files that no catalog entry names SHALL NOT be copied. The tool SHALL NOT write the module's own tables, including its hosted checks, which the module makes after its first start. It SHALL never change the source library: it SHALL open the catalog read-only and immutable, hold the library's owner lock shared without writing, and open every file read-only without following a link.

#### Scenario: A synthetic library of the installed schema
- **WHEN** the tool migrates a synthetic library of schema version 3 with stills, a GIF, a JPEG, a GIF whose canvas is over 4,096 x 4,096 pixels, an asset with two renditions, three playlists (one empty, one naming a rendition twice), a session with the player's checkpoint, a pending cleanup with its orphaned original and a leftover staging folder
- **THEN** the destination's assets, renditions, playlists and items equal the source's, each playlist keeps its order and its references, every original and rendition file is byte-identical and private, the orphaned original and the staging folder are not copied, the session, checkpoint and cleanup tables are empty, the destination is at the library's current schema, and the report counts one session, one checkpoint, one cleanup and one large GIF original

#### Scenario: The module starts on the migrated store
- **WHEN** the Pixoo module starts on the destination
- **THEN** it serves one `pixoo-rendition/2.0` record per migrated rendition and the migrated playlists with their items in order, and a `media-start` of a migrated playlist plays it on the simulated Pixoo

#### Scenario: A rerun into a fresh destination
- **WHEN** the tool migrates the same library into a second fresh state directory
- **THEN** its report, with the digests of the carried rows and of the copied files, equals the first one's, and the two destinations hold the same files

#### Scenario: The source is never changed
- **WHEN** the tool has migrated and verified the library, refused it and failed on copies of it
- **THEN** every entry of the source library has the type, mode, size, modification time and content it had before, and no file was added beside it

### Requirement: Migration refusals and failures

The tool SHALL refuse with exit code 3, before it writes anything to the module's files, and name the refusal's code with fixed text: `usage` is exit code 2 instead, for malformed arguments; `runtime-running` while a runtime, or another tool, holds the state directory's lease; `disk-short` when the free space is less than the source files' bytes plus the source catalog's size plus `--min-free-bytes` (256 MiB by default); `destination-not-empty` when the module already has a database, a log, a journal or a non-empty folder; `source-missing` for a directory without a catalog; `source-in-use` while the Pixoo service holds the library's owner lock; `source-not-clean` for a catalog with a non-empty log or a journal; `source-schema` for another application ID, user version or set of migrations, or tables, indexes or triggers that differ from the installed schema's; and `source-corrupt` for a catalog that fails SQLite's checks or names a file that is missing, a link, too large or not a regular file. Once it has begun to write, a failure SHALL exit with code 4, name its code (`source-corrupt` when the library's own check refuses a copy, `disk-short` for a full disk), and SHALL remove the module's database files and folder, saying whether it did. While the tool runs, a runtime that starts on the state directory SHALL fail to take the lease, and the Pixoo service SHALL fail to open its library.

#### Scenario: A running runtime
- **WHEN** a runtime runs on the state directory and the tool is asked to migrate or verify
- **THEN** each is refused `runtime-running` with exit code 3 and the module has no files, and once the runtime stops, the migration runs

#### Scenario: A runtime started during a migration
- **WHEN** a runtime starts while the tool holds the lease
- **THEN** its core fails to take the lease and the runtime exits 1 with `core-failed`

#### Scenario: A short disk
- **WHEN** the free space is less than the library needs plus the space to keep free, or `--min-free-bytes` is larger than the file system's free space
- **THEN** the migration is refused `disk-short` with exit code 3, and nothing is written

#### Scenario: A destination that already has files
- **WHEN** the module already has a migrated database, or its folder holds a file
- **THEN** the migration is refused `destination-not-empty`, and an earlier migration still verifies

#### Scenario: A source the tool cannot carry
- **WHEN** the library directory has no catalog, the Pixoo service holds it, its catalog's log holds commits, its application ID or user version is not the installed release's, it is at schema version 4, a table has an added column, a frame is missing, or an original is a link
- **THEN** each is refused with its code, and the running migration, conversely, keeps the Pixoo service from opening the library

#### Scenario: A file that does not match its catalog
- **WHEN** a frame's bytes or a manifest no longer match the catalog
- **THEN** the migration fails `source-corrupt` with exit code 4, the module's database and folder are removed, and a migration of the intact library into the same state directory then succeeds

### Requirement: Migration verifier

`node apps/runtime/dist/src/migrate-pixoo.js verify --library <dir> --state-dir <dir>` SHALL hold the runtime's lease and the library's owner lock, open the module's database read-only and immutable, and compare the migration with the source. It SHALL count, each by kind: `database` for a database file that is missing, not a private regular file with one link, has a log or journal with content, is not at the library's current schema with exactly its tables beside the module's and the SDK's, or fails SQLite's checks; `assets`, `renditions`, `playlists` and `items` for each row missing, extra or different by ID; `leftInBackup` for each row in a table that starts fresh; `files` for each file the source catalog names whose copy is missing, not a private regular file with one link, or differs from the source's SHA-256, or whose source no longer matches its catalog; and `unexpected` for anything else in the module's folder or a directory there that is not private. It SHALL exit 0 only when every count is zero and 1 otherwise, and SHALL refuse with `destination-missing` a state directory with no module database.

#### Scenario: A clean migration
- **WHEN** the verifier checks a migration of the synthetic library
- **THEN** it reports `verified` with every count zero, the same digests as the migration's report and exit code 0

#### Scenario: A planted corruption
- **WHEN** a frame byte changes, an original is removed, a manifest is truncated, a copy is opened to others, a copy is replaced by a link, an extra file appears, a playlist is renamed, two items swap positions, an asset or a session row is added, the database has a log with content or an extra table, or the database is missing
- **THEN** the verifier reports `mismatch` with exactly the matching counts and exits 1

### Requirement: Migration output

The tool SHALL write exactly one JSON line to standard output, with the schema `pixoo-migration/1.0`, its operation and its result: `migrated` with the counts of assets, renditions, playlists, items, originals, rendition files and bytes, the counts left in the backup, the count of GIF originals whose canvas is over 4,096 x 4,096 pixels, and the SHA-256 digests of the carried rows and of the copied files; `verified` or `mismatch` with the same counts and digests and each kind's mismatch count; or `refused` or `failed` with a code and fixed text. No line SHALL hold a path, an asset or playlist name, a title or a file's content.

#### Scenario: Counts, codes and hashes only
- **WHEN** the tool migrates and verifies a synthetic library whose names include a marker
- **THEN** neither line holds the marker, any name, the library's or the state directory's path, or a file path
