## ADDED Requirements

### Requirement: One full-disk test

The SDK SHALL export `fullDisk(error)`, which SHALL be true when the error, or one of at most seven causes that wrap it, carries `SQLITE_FULL` in the low byte of its `errcode`, as node:sqlite reports a full database, or the code `ENOSPC`, as the file system reports a full disk, and false otherwise. It SHALL read only those codes, never an error's text, and SHALL end its walk at a cycle or after the seventh cause. `openModuleDatabaseFile`, the Nanoleaf module and the runtime's migration tools SHALL use it rather than a check of their own.

#### Scenario: A full disk by its codes
- **WHEN** a real full database's error, an extended result code with `SQLITE_FULL` in its low byte, an `ENOSPC` error, and each of those one cause deep or seven causes deep is tested
- **THEN** each is a full disk

#### Scenario: Nothing else
- **WHEN** a full disk eight causes deep, `SQLITE_BUSY`, `EACCES`, an error whose text alone says the disk is full, a value that is not an object, and an error that is its own cause are tested
- **THEN** none is a full disk, and the walk ends
