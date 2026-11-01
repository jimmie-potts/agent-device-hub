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
forced disabled and private persistent state/configuration. Client credentials SHALL
remain empty by default; an explicit source selection MAY admit exactly one
matching ingest-only credential with no read, control, admin, role or robot grant.
The native producer SHALL retain the private bearer and the hub only its digest.
It SHALL retain canonical loopback Host/Origin checks while separating the socket
bind. Docker SHALL expose only host127.0.0.1 TCP18788 to container18788 on a
dedicated ordinary bridge with no other container attached and outbound access
permitted. Effective running port publication SHALL match the configured loopback
binding. Native and isolated
defaults SHALL remain unchanged. No LAN/remote ingress or automatic restart is added.
The profile SHALL admit a configuration section only for a shipped module that
declares no device simulation, or whose registration says of that section that it
reaches no local device or file (`hostLocal`, Hub #567), and only without a `secrets`
member and with a section for each module it starts after. It SHALL start the core and each admitted
module that has a section, in shipped order. Startup SHALL refuse a section for
any other module, and an admitted module whose accepted configuration names a device. Each refusal uses the fixed refusal, which repeats
no configured value.

#### Scenario: Local browser operation
- **WHEN** the approved new profile is privately provisioned and started
- **THEN** the actual Mac-local browser signs in through the existing trusted-local session flow, renders core views and has healthy core-only operation without device modules or a browser API token

#### Scenario: Access or isolation mismatch
- **WHEN** Host/Origin is unwanted, a binding is widened, another network/container is attached, or device control is enabled
- **THEN** admission refuses, unsupported startup has no runtime effects and an isolation failure after startup stops the new owned profile without deleting state

#### Scenario: Fresh private provisioning and maintenance
- **WHEN** the new stopped volumes have the exact seeded config and empty secrets
- **THEN** one-shot preparation publishes only the browser config and empty credentials with private modes; unexpected or partial inputs refuse, and ordinary stopped backup and separate empty restore protections remain in force

#### Scenario: Explicit local lifecycle grant
- **WHEN** an operator selects one source-derived ingest source and its matching credential
- **THEN** only that single ingest grant is admitted, existing browser access remains unchanged, and absent selection or additional/wider/mismatched grants refuse before startup effects

#### Scenario: Admitted non-device module
- **WHEN** the owner adds a section for a shipped module that declares no device simulation to the private configuration
- **THEN** startup runs the core and that module with device control still disabled, and health lists the module

#### Scenario: Admitted remote-only Codex Desktop section
- **WHEN** the owner adds a `codex-desktop` section whose sources are all remote, with no `home`
- **THEN** startup runs the core and the module with device control still disabled and no local file read, and a section with any `home` is refused with the fixed refusal

#### Scenario: Refused module section
- **WHEN** the configuration has a section for a module that declares a device simulation and does not call it host-local, for an unknown module, with a `secrets` member, or for a module that starts after one without a section, or an admitted module's accepted configuration names a device
- **THEN** startup refuses with the fixed refusal before state effects, and the configuration file and volumes are unchanged

#### Scenario: Admitted module that fails to start
- **WHEN** an admitted module refuses its section or fails to start
- **THEN** the core and the other modules keep running, and health shows that module `refused` or `failed`

### Requirement: Explicit production device profile

The container SHALL offer an explicitly selected production profile with device control disabled by default. With control enabled it SHALL admit only explicitly configured shipped modules, in their shipped dependency order, using their existing configuration, private-secret and device contracts. Unknown modules and missing configured dependencies SHALL refuse before state effects. Unconfigured modules SHALL remain inactive. Existing host-local and private-proxy profiles SHALL retain their device-control and named-device refusals.

The production profile SHALL reuse authenticated private-proxy access, host-loopback gateway publication, Host/Origin checks, private state/configuration/secrets volumes and the local writer lease. Secrets SHALL remain canonical references within the existing private secrets directory. Device control SHALL require explicit enablement; disabled production operation SHALL refuse configured devices. Profile admission SHALL NOT qualify physical devices or override existing module refusals, supported models or read-only controls.

The operator SHALL verify the selected profile, control mode, private mounts, gateway binding and dedicated network before and after start. An optional Pixoo hosted-GIF listener SHALL use one explicitly selected private host IPv4 address at TCP 41240, distinct from the gateway. Unexpected listeners, writable dependency mounts and networking privileges SHALL be refused. No ADB server, pairing, account login or automatic cross-host handoff SHALL be created.

#### Scenario: Configured shipped modules start
- **WHEN** the operator explicitly selects production with enabled control and valid sections for shipped household modules
- **THEN** only those modules and the core start in dependency order, existing admitted non-device modules remain available, and invalid or unavailable module dependencies retain their existing honest outcomes

#### Scenario: Safe defaults and retained profiles
- **WHEN** control is omitted, or the host-local/private-proxy profile is selected with enabled control or a named device
- **THEN** device control remains disabled by default and the forbidden configuration refuses without activating a device

#### Scenario: Unsafe production input
- **WHEN** a module is unknown, a required module section is absent, a secret escapes the private secrets directory, mounts or gateway bindings widen, or another state owner holds the lease
- **THEN** startup refuses with the existing fixed refusal family and creates no competing writer or leaked private diagnostic value

#### Scenario: Explicit hosted-GIF access
- **WHEN** the operator selects the optional private IPv4 Pixoo binding matching its configured hosted-GIF origin and listener
- **THEN** only that TCP 41240 binding is added and the dashboard gateway remains host-loopback only, while absent or mismatched listener selection refuses the hosted listener

#### Scenario: Disposable and installed evidence stay separate
- **WHEN** fresh synthetic module state runs with simulated transports in a disposable instance
- **THEN** health reports actual module results without physical requests, while installed image verification keeps control disabled and configures no physical device

### Requirement: Mac-local diagnostics stack
The repository SHALL define one owned Compose project, `bunny-diagnostics` (`deploy/diagnostics/compose.yaml`), with an OpenTelemetry Collector, Loki, Tempo and Grafana pinned by multi-architecture image digests, that the operator starts and stops by hand beside the runtime (Hub #813). It SHALL publish only Grafana on `127.0.0.1:3000` and the Collector's OTLP/HTTP receiver on `127.0.0.1:4318`, on its own bridge network that the runtime never joins; the runtime SHALL reach the Collector through `host.docker.internal`. Logs SHALL reach Loki and spans Tempo on one OTLP path each, with the Collector copying the event name to the queryable `event_name` attribute, Loki's stream labels limited to the contract's namespace, service and environment and everything else structured metadata. Grafana SHALL be provisioned with the Loki and Tempo sources, a `trace_id` derived field that opens the trace and a traces-to-logs query that finds the trace's records, and the starter dashboard; it SHALL be reached without a password on the Mac's loopback, as the trusted-loopback dashboard sign-in is, as an anonymous Editor that can use Explore and save dashboards but cannot add a data source, with sign-up, the login form, analytics and plugin fetches off. Loki and Tempo SHALL retain seven days with their compactors and SHALL bound admission (Loki 1 MiB/s with a 4 MiB burst and 16 KB lines; Tempo 2 MiB/s with 5 MiB per trace); the Collector SHALL retry a refusing backend for at most 30 seconds and then drop; every container SHALL have a memory limit, no restart policy, a read-only root, dropped capabilities and no new privileges. The three data volumes SHALL hold diagnostic data only, which `down -v` may delete; nothing SHALL back up, restore, spool or replay it, and no Collector or runtime failure SHALL change an application result.

#### Scenario: A synthetic record and span reach the viewer
- **WHEN** a disposable copy of the project starts on alternate loopback ports and one profile 1.7 record and one span with the same trace ID are posted to the Collector
- **THEN** Grafana's health is `ok`, both datasources and the starter dashboard are provisioned, Loki answers the trace-ID query with the record's labels and structured metadata, and Tempo returns the span, and `down -v` leaves no container, network or volume of that project

#### Scenario: The operating procedure
- **WHEN** the operator follows the container guide's "Diagnostics stack" section
- **THEN** the pinned images are pulled once, the project is created, started, inspected and stopped with the documented commands, actual volume usage is read with Docker's accounting, and loss is read from the Collector's log and the runtime's `telemetry.dropped` and `runtime.stopped` records

### Requirement: Qualified bounded batch deployment

The host operator SHALL consume only matching successful hosted qualification for an exact committed revision and immutable Linux ARM64 production image. It SHALL bind the selected project, previous and target identities, included issues, designated owner, focused storage assessment, required client checks and recovery decision to one private deployment record. It SHALL serialize deployment and manual maintenance, verify stopped writer exit, take and verify a consistent backup, preserve private volumes/configuration/network, select the image once and verify exact running identity, health and the selected read-only client path before success. The verified writer release SHALL be reusable without another conversational acknowledgment.

#### Scenario: Verified batch
- **WHEN** a matching qualified artifact is selected for the established owned target and its bounded checks pass
- **THEN** the private record identifies the installed revision/image, backup, checks and actual writer release without claiming physical acceptance

#### Scenario: Ineligible artifact or overlapping operation
- **WHEN** qualification is absent, failed, incomplete, wrong-revision or wrong-image, or another operation holds the selected project
- **THEN** promotion refuses before stopping or changing the selected runtime and preserves existing evidence

### Requirement: Inspectable failed and interrupted deployment

Each deployment SHALL durably record its intended phase before effects. Interruption, failed start or failed client verification SHALL preserve latest state and unfinished evidence, stop only the owned failed replacement where possible and report failed or uncertain outcomes honestly. New maintenance SHALL refuse unfinished deployment until an explicit reconciliation verifies actual state and records the result. Reconciliation SHALL NOT automatically resume replacement, clear a live owner's lock, retry, restore a snapshot or select an image.

#### Scenario: Interrupted or failed replacement
- **WHEN** replacement is interrupted or a selected check fails
- **THEN** the last intended phase remains inspectable, latest data is preserved, another operation refuses, and explicit reconciliation records actual identity and process state before releasing the hold

### Requirement: Explicit latest-state compatible image return

Returning to a previous image SHALL require explicit reader/configuration compatibility evidence bound to the latest stopped state and the exact previous image. Unknown, incompatible or stale evidence SHALL refuse return without deleting current data or restoring an older snapshot. Unknown recovery SHALL NOT by itself prevent an otherwise eligible forward deployment.

#### Scenario: Qualified previous reader
- **WHEN** the previous image has reopened the candidate's newly written disposable state and compatibility matches the latest stopped backup and configuration
- **THEN** explicit image return preserves that latest state and follows the same exclusion, identity, health and client checks

#### Scenario: Incompatible or unknown reader
- **WHEN** previous-reader compatibility is unknown, incompatible or does not match latest state
- **THEN** return refuses before image replacement while a separately eligible forward operation remains possible
