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

### Requirement: Explicit trusted-local browser profile

The container SHALL offer an explicit host-local profile with device control
forced disabled, fresh private state/configuration and empty client credentials.
It SHALL retain canonical loopback Host/Origin checks while separating the socket
bind. Docker SHALL expose only host127.0.0.1 TCP18788 to container18788 on a
dedicated ordinary bridge with no other container attached and outbound access
permitted. Effective running port publication SHALL match the configured loopback
binding. Native and isolated
defaults SHALL remain unchanged. No LAN/remote ingress or automatic restart is added.
The profile SHALL admit a configuration section only for a shipped module that
declares no device simulation, and only without a `secrets` member and with a
section for each module it starts after. It SHALL start the core and each admitted
module that has a section, in shipped order. Startup SHALL refuse a section for
any other module, and an admitted module whose accepted configuration names a device. Each refusal uses the fixed refusal, which repeats
no configured value.

#### Scenario: Local browser operation
- **WHEN** the approved new profile is privately provisioned and started
- **THEN** the actual Mac-local browser signs in through the existing trusted-local session flow, renders core views and has healthy core-only operation without API tokens or device modules

#### Scenario: Access or isolation mismatch
- **WHEN** Host/Origin is unwanted, a binding is widened, another network/container is attached, or device control is enabled
- **THEN** admission refuses, unsupported startup has no runtime effects and an isolation failure after startup stops the new owned profile without deleting state

#### Scenario: Fresh private provisioning and maintenance
- **WHEN** the new stopped volumes have the exact seeded config and empty secrets
- **THEN** one-shot preparation publishes only the browser config and empty credentials with private modes; unexpected or partial inputs refuse, and ordinary stopped backup and separate empty restore protections remain in force

#### Scenario: Admitted non-device module
- **WHEN** the owner adds a section for a shipped module that declares no device simulation to the private configuration
- **THEN** startup runs the core and that module with device control still disabled, and health lists the module

#### Scenario: Refused module section
- **WHEN** the configuration has a section for a module that declares a device simulation, for an unknown module, with a `secrets` member, or for a module that starts after one without a section, or an admitted module's accepted configuration names a device
- **THEN** startup refuses with the fixed refusal before state effects, and the configuration file and volumes are unchanged

#### Scenario: Admitted module that fails to start
- **WHEN** an admitted module refuses its section or fails to start
- **THEN** the core and the other modules keep running, and health shows that module `refused` or `failed`
