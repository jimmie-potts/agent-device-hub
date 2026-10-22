# bunny-container-operator Specification

## Purpose
Define the single-operator Linux container profile, early local state ownership,
private persistent volumes and explicit stopped backup/empty restore. Preserve
manual cross-host device handoff and separate source, architecture and live
acceptance boundaries without an automatic migration or lifecycle framework.

## Requirements

### Requirement: Explicit private container startup

The container profile SHALL use the same runtime/configuration contracts on
Linux amd64 and arm64, with persistent private state/config/secrets outside the
disposable container. It SHALL bind an acquired local data lease to the actual
core before runtime effects, retain ownership until process exit and refuse
pending restore or unsafe inherited coordination. It SHALL default to disabled
device control and SHALL NOT create remote ingress or automatic host handoff.

#### Scenario: Start, health and stop
- **WHEN** an operator starts a new privately provisioned core-only instance
- **THEN** health reports the real core running through container loopback, state persists across clean stop/restart, and process status remains distinct from health

#### Scenario: Competing or interrupted owner
- **WHEN** the local lease is held, its inode is aliased, or a pending restore marker exists
- **THEN** competing startup refuses before store/listener/device effects without clearing that evidence or releasing the held owner's lock

#### Scenario: Decoder child outlives its runtime
- **WHEN** a Pixoo decoder child is slow, cancelled or survives parent exit
- **THEN** it cannot write rendition state; the parent owns staged writes and waits for child close and its outstanding I/O before cleanup

### Requirement: Manual stopped backup and empty restore

The operator SHALL verify the selected stopped container/image and distinct
ordinary local input/archive volumes, acquire the actual state lease and verify
private inventory, config/references, integrity and database/key pairing. It
SHALL retain WAL/assets/internal keys, reference rather than copy external
credentials, refuse held-owner aliases before reads and synchronize successful
output. Restore SHALL require the exact source revision/config/references and
a separate empty target, preserve partial failures behind a durable pending
marker and leave successful restores stopped. Local archive storage SHALL NOT
be described as off-host recovery or cross-host writer exclusion.

#### Scenario: Restore a verified snapshot
- **WHEN** an operator backs up a stopped synthetic instance and restores into a separate empty instance with matching revision/config/references
- **THEN** the snapshot records/assets and internal keys verify, the target stays stopped until an explicit start, and the original instance is preserved

#### Scenario: Invalid or interrupted archive operation
- **WHEN** inventory/integrity/reference/key checks fail, the target is occupied, or restore is interrupted
- **THEN** the operation reports refusal or failure, preserves partial output, never activates a runtime and never clears a pending marker merely to permit startup

#### Scenario: Architecture and live-operation limits
- **WHEN** separate same-architecture synthetic restores pass on amd64 and arm64
- **THEN** evidence names those two container targets and does not claim cross-architecture archive transfer, native Windows/macOS runtime, actual collector/device qualification or live deployment
