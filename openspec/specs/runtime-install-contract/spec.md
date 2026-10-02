## Purpose

Define verifiable release identities and installation receipts so separately owned runtimes can upgrade and recover without losing current state or replacing shared files.

## Requirements

### Requirement: Trusted release and bounded legacy identity

New releases MUST identify a clean merged full source SHA and verified archive and manifest SHA-256 hashes. A first-adoption recovery copy MAY use an explicit legacy identity only with verified content hashes, compatibility and process recovery evidence.

#### Scenario: Untrusted new build
- **WHEN** a new release lacks a full trusted SHA or contains dirty source
- **THEN** staging refuses it and cannot use the legacy exception

#### Scenario: Existing build has no trusted SHA
- **WHEN** first adoption retains the existing bytes for recovery
- **THEN** their legacy identity remains outside the SHA release store and recovery requires executable/start-time and served-artifact evidence if build health is absent

### Requirement: Separate ownership and exact approval

Consumer operations MUST preserve the shared runtime parent, Node executable, other owners' paths and historical copies. Read-only plan and status MUST distinguish installed, running and remote identities. Mutation MUST require approval bound to exact target, complete included changes, baseline, configuration, outage and recovery procedure; changed inputs require replanning.

#### Scenario: Either runtime adopts first
- **WHEN** Hub or Nanoleaf adopts, upgrades and rolls back through its own current anchor
- **THEN** the other owner's paths and shared Node remain unchanged and resolve in either adoption order

#### Scenario: Baseline changes after approval
- **WHEN** the installed identity, configuration or approved target differs under the installation lock
- **THEN** the command refuses before stopping services

### Requirement: Compatible recovery preserves current state

Consumer operations MUST stage and verify before outage, prove rollback compatibility, lock and persist intent, quiesce all named writers before backup, atomically switch only the owning anchor and verify bounded operational health and running identity. Recovery MUST preserve the latest durable state. Only verified success with a durable final receipt permits pruning to current plus three previous successful releases.

#### Scenario: Rollback is unknown or incompatible
- **WHEN** recovery compatibility cannot be proved before an upgrade
- **THEN** the routine command refuses before stopping services without an override

#### Scenario: Candidate fails after writing newer state
- **WHEN** target health fails after durable writes
- **THEN** recovery stops that process, switches to the verified compatible previous release, reopens the latest state and verifies recovery without restoring an old database

### Requirement: Truthful versioned receipts

The contract MUST provide closed install-receipt/1.0 shapes with shared TypeScript/Python fixtures. Receipts MUST distinguish intent, success, refusal, failure before switch, failed upgrade with verified recovery, failed rollback, interrupted/unknown operation and receipt-finalization failure. Success MUST agree with observed identity and healthy checks. Unknown targets MUST remain absent rather than fabricated.

#### Scenario: Contradictory recovery claim
- **WHEN** a receipt claims success with failed health or a successful rollback without the verified previous identity
- **THEN** both validators reject it

#### Scenario: Final receipt cannot be persisted
- **WHEN** health succeeds but final receipt persistence fails
- **THEN** the operation returns failure, retains durable intent and requires inspection without blind replay or pruning

### Requirement: Consumer adoption and publication

The contract MUST define startup-scoped build metadata and the root instruction declaration, map historical receipt fields without private values, and ship an immutable contracts 1.2.0 archive with source/hash receipt after owner approval. It MUST preserve controller and lifecycle behavior and confer no installation authority.

#### Scenario: Link changes beneath a running process
- **WHEN** a new current link is selected without restarting the old process
- **THEN** the old process continues reporting its startup build, using unknown for untrusted metadata

#### Scenario: Agent delivers a source-only consumer change
- **WHEN** the owning issue explicitly batches installation into another issue
- **THEN** the root declaration retains that exception, while ordinary installed-runtime delivery offers the documented plan at a separately approved checkpoint
