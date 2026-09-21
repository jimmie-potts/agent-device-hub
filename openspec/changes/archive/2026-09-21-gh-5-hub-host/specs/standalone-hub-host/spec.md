## Purpose

Provide one optional Linux standalone owner for shared agent monitoring and bounded routing to existing device controllers without moving their private state or physical writers.

## ADDED Requirements

### Requirement: Private durable ownership
The host SHALL compose the shared agent-state core with private Linux storage, cross-process exclusivity, atomic revision-checked commits and explicit graceful shutdown.

#### Scenario: Concurrent owner and restart
- **WHEN** another process tries to acquire the occupied store
- **THEN** it fails without changing state, and after owner exit the next owner restores labels, notices and revisions with active evidence uncertain

#### Scenario: Interrupted commit
- **WHEN** a commit fails or the process terminates
- **THEN** restart reads a complete old or new revision and never publishes a speculative partial state

### Requirement: Authenticated bounded shared transport
The host SHALL serve authenticated loopback sessions, ingestion, commands and revisioned changes compatible with Pixoo's selected-source protocol. Authorization SHALL precede replay and preserve privacy, Host/Origin protections and finite resource limits.

#### Scenario: Unauthorized and oversized requests
- **WHEN** a credential is absent, revoked, out of scope or a request exceeds the declared limits
- **THEN** it is rejected without state or device effects and without echoing secrets or private payloads

#### Scenario: Labels and acknowledgment through selected owner
- **WHEN** a remote Pixoo facade reads or submits an authorized label or notice acknowledgment
- **THEN** the selected shared owner handles it, while no local reducer or second owner starts

#### Scenario: Replay and slow consumers
- **WHEN** a command ticket is repeated or a consumer reconnects after overflow
- **THEN** identical commands retain their result, conflicting tickets reject, and consumers resync current state without replaying effects or delaying healthy consumers

### Requirement: Independent controller routing
The host SHALL route only validated commands to fixed configured owners with separate bounded queues, timeouts and health. It SHALL NOT send device protocols, expose native credentials or automatically retry ambiguous writes.

#### Scenario: Stalled Pixoo
- **WHEN** Pixoo times out while Nanoleaf is responsive
- **THEN** Nanoleaf reads and commands and agent ingestion continue independently, and Pixoo effects remain uncertain after an ambiguous submission

#### Scenario: Versioned integration settings
- **WHEN** a client requests supported Nanoleaf settings or Pixoo monitor settings
- **THEN** the host uses the owning versioned API with revisions, target scope and compatibility fixtures, rejecting absent or incompatible capabilities without widening controller v1

### Requirement: Fenced owner migration
The host SHALL support versioned quiesce/export, empty-destination import, readiness-gated activation and rollback that preserve owner/session identities, revisions, labels and notices. It SHALL resume ingestion only after the old owner has released and producer/consumer routes are ready.

#### Scenario: Interrupted cutover
- **WHEN** destination readiness or consumer switching fails
- **THEN** ingestion remains fenced across restart, no fallback reducer starts, and rollback requires destination release before activating a fresh selected owner

#### Scenario: Rollback after writes
- **WHEN** rollback follows accepted destination writes
- **THEN** a new validated quiesced export preserves those writes in an empty selected store instead of reopening a stale copy

#### Scenario: Release proof and runtime staging
- **WHEN** migration imports a stopped supervised owner's export
- **THEN** import requires one single-use release capability and runtime-enforced staged admission; a copied export or arbitrary PID is insufficient

#### Scenario: Interrupted route update
- **WHEN** the coordinator exits or file synchronization fails after route replacement
- **THEN** durable intent preserves original producer enablement, another live coordinator is refused, and recovery requires known file bytes under an exclusive lease

### Requirement: Reproducible Linux source delivery
The host SHALL provide reproducible packaging, isolated runtime configuration, readiness, shutdown, compatibility documentation and measured responsiveness against the frozen early budget artifact.

#### Scenario: Isolated package and checks
- **WHEN** a fresh Linux consumer installs the built artifact
- **THEN** it can run the host with disposable storage and fake controllers without sibling-checkout imports, real credentials, installed hooks or device operations

#### Scenario: Evidence boundaries
- **WHEN** source checks pass
- **THEN** the report distinguishes them from numeric qualification, installed WSL/client acceptance, physical accuracy and public guide publication
