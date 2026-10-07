## ADDED Requirements

### Requirement: Offline tools hold the runtime's lease

`holdRuntimeLease(stateDir)` in `apps/runtime` SHALL take the core's lease on a state directory, the exclusive transaction on `modules/core.sqlite-owner` that the core holds from its start until it stops, without waiting, and SHALL hold it until `release`. It SHALL refuse with `runtime-running` while a runtime or another tool holds it, and with `lease-unavailable` when the lock file is not a regular file private to the user. It SHALL create `modules/` and the lock file, owner-only, when they are missing, as the core does, and SHALL write nothing to the lock file. An offline tool that changes a module's files, such as the Pixoo library migration, SHALL hold the lease for as long as it runs.

#### Scenario: A tool and a runtime on one state directory
- **WHEN** a runtime runs on a state directory and a tool asks for the lease
- **THEN** the tool is refused `runtime-running`; and when a tool holds the lease and a runtime starts, the runtime's core fails to take it and the runtime exits 1 with `core-failed`

### Requirement: A disposable run on a migrated Pixoo library

The runtime verification adapter SHALL offer the run scenario `pixoo-migrated`: its seed SHALL write a synthetic Pixoo library of the installed schema version 3 to `<data>/pixoo-library`, run the Pixoo library migration's `migrate` and `verify` into the run's state directory, as the installer will at the cutover, keep each one's JSON line in `<data>/migration/`, and fail the start unless both exit 0. The run SHALL then start the shipped runtime, with each module's simulated section, on that state directory, so a reviewer reads the migrated library through the gateway and runs the tool by hand against the run's library.

#### Scenario: The shipped runtime on a migrated library
- **WHEN** a run starts with `pixoo-migrated`
- **THEN** both kept lines report zero mismatches, the Pixoo module is running, the gateway's `pixoo-playlist` and `pixoo-rendition` families hold the migrated playlists, with their items in order, and renditions, and the tool asked to verify the run's state directory while the runtime runs is refused `runtime-running`
