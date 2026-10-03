## MODIFIED Requirements

### Requirement: Read-only plan and explicit operation approval

The Hub updater SHALL provide `plan`, `status`, `upgrade` and `rollback`. Plan and status MUST distinguish installed, running and remote identities without changing the installation. An operation MUST bind its reviewed plan digest to the full merged target, complete change bundle, baseline, configuration, named service, outage, backup and recovery route, and recheck these inputs under an exclusive installation lock. The coordinator MUST verify applicable owner authority for that exact operation; scoped standing installation authority requires no renewed human approval.

#### Scenario: Changed or concurrent baseline
- **WHEN** the approved baseline or configuration changes, another operation holds the lock, or an unresolved operation remains
- **THEN** execution refuses before service stop and retains an inspectable reason without blind replay

#### Scenario: Inactive or unavailable identity
- **WHEN** the service is inactive or remote comparison cannot be read
- **THEN** status reports no current running identity or an unknown remote comparison respectively, without claiming installation success

### Requirement: Discoverable installation checkpoint

Root agent instructions SHALL state installation completion and its source-only batching exception, require a coordinator checkpoint against applicable owner authority before effects, and point to one setup procedure that requires plan before installation or rollback. Source tests MUST remain distinct from the real approved migration, upgrade, rollback and re-upgrade acceptance.

#### Scenario: Root-launched upgrade request
- **WHEN** a fresh agent receives an installed-Hub upgrade request
- **THEN** it reads the setup procedure, runs plan and reviews the exact sequence against existing authority; it proceeds without renewed approval within standing scope and stops only for effects outside that scope or other unmet gates
