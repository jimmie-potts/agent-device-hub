## MODIFIED Requirements

### Requirement: Separate ownership and exact approval

Consumer operations MUST preserve the shared runtime parent, Node executable, other owners' paths and historical copies. Read-only plan and status MUST distinguish installed, running and remote identities. Mutation MUST require applicable owner authority and a reviewed plan bound to exact target, complete included changes, baseline, configuration, outage and recovery procedure; changed inputs require replanning and a scope check. Existing scoped standing installation authority MUST satisfy the authorization checkpoint without renewed human approval. The coordinator MUST obtain additional authority for effects outside that scope; this contract grants no authority itself.

#### Scenario: Either runtime adopts first
- **WHEN** Hub or Nanoleaf adopts, upgrades and rolls back through its own current anchor
- **THEN** the other owner's paths and shared Node remain unchanged and resolve in either adoption order

#### Scenario: Baseline changes after approval
- **WHEN** the installed identity, configuration or approved target differs under the installation lock
- **THEN** the command refuses before stopping services

#### Scenario: Standing authority covers the exact operation
- **WHEN** the coordinator has existing owner authorization for routine delivery to the established installation and the exact plan remains within that scope
- **THEN** it may execute using the reviewed plan digest without renewed human approval, while ownership, compatibility, locking, recovery and verification remain mandatory

### Requirement: Consumer adoption and publication

The contract MUST define startup-scoped build metadata and the root instruction declaration, map historical receipt fields without private values, and ship an immutable contracts 1.2.0 archive with source/hash receipt after owner approval. It MUST preserve controller and lifecycle behavior and confer no installation authority.

#### Scenario: Link changes beneath a running process
- **WHEN** a new current link is selected without restarting the old process
- **THEN** the old process continues reporting its startup build, using unknown for untrusted metadata

#### Scenario: Agent delivers a source-only consumer change
- **WHEN** the owning issue explicitly batches installation into another issue
- **THEN** the root declaration retains that exception, while ordinary installed-runtime delivery reviews and executes the documented plan under applicable owner authority without renewing existing scoped standing approval; source-only completion leaves overall installation pending
