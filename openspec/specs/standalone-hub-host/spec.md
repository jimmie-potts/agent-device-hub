## Purpose

Provide one optional Linux standalone owner for shared agent monitoring and bounded routing to existing device controllers without moving their private state or physical writers.

## Requirements

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

### Requirement: Private bounded browser handoff
The host SHALL issue browser launch codes only through an owner-only local channel. It SHALL accept each code once within a bounded lifetime and issue a time-limited bearer restricted to read/control on configured aliases. The bearer MUST NOT grant ingest, admin or MCP access. Missing, invalid, replayed and expired codes, and disallowed origins MUST fail without state or device effects. Closing or replacing host authority SHALL revoke ephemeral sessions.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with configured alias read/control permission

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

### Requirement: Authorized monitor approval recovery
The host SHALL expose explicit approval recovery only to a control credential. It SHALL validate the full session identity, known turn and expected owner revision, retain command request replay behavior and return a fixed failure when the owner rejects recovery. It SHALL NOT contact a device or provider permission service.

#### Scenario: Guarded control request
- **WHEN** a control client submits recovery for an uncertain approval using a current revision and request ID
- **THEN** the host returns the owner result, and a repeated identical ticket returns the same result without a second mutation

#### Scenario: Unauthorized or stale request
- **WHEN** a client lacks control scope or the owner revision has changed
- **THEN** recovery does not mutate owner state
