## MODIFIED Requirements

### Requirement: Guarded manual successor operations
The current-runtime mapping SHALL permit explicit manual service and recovery
steps under one held operation lock, guarded by preflight and durable intent.
It SHALL preserve required integrity, compatibility, latest-state recovery,
identity, health and receipt evidence. It SHALL retain all owned recovery releases
for the initial procedure and SHALL NOT require an automatic recovery engine.

#### Scenario: Candidate health fails during a manual operation
- **WHEN** the candidate cannot establish its required identity and health
- **THEN** the operation remains unsuccessful, and the operator uses only the named compatible latest-state recovery steps while retaining its intent and evidence

#### Scenario: New module is absent from the selected installation
- **WHEN** the exact configuration omits ONN, its durable state is proven absent and the candidate creates no ONN state or effects
- **THEN** a configuration-bound recovery proof MAY exclude that absent owner, but activation or any ONN state invalidates this proof and requires qualified ONN-capable recovery

For the current TypeScript runtime, routine forward admission SHALL use focused storage-change evidence and independent recovery eligibility under bunny-runtime-upgrades. Unknown recovery SHALL allow forward planning and refuse recovery execution. This successor exception MUST NOT change the released legacy Hub/Nanoleaf installer contracts or receipt schema.

#### Scenario: Forward plan has unknown downgrade compatibility
- **WHEN** the established current runtime has a verified target and focused change assessment but no qualified recovery reader
- **THEN** forward planning remains eligible and recovery remains refused independently



### Requirement: Compatible recovery preserves current state

Retained legacy consumer operations MUST stage and verify before outage, prove rollback compatibility, lock and persist intent, quiesce all named writers before backup, atomically switch only the owning anchor and verify bounded operational health and running identity. Recovery MUST preserve the latest durable state. Only verified success with a durable final receipt permits pruning to current plus three previous successful releases.

#### Scenario: Rollback is unknown or incompatible
- **WHEN** recovery compatibility cannot be proved before a retained legacy upgrade
- **THEN** the routine command refuses before stopping services without an override

#### Scenario: Candidate fails after writing newer state
- **WHEN** a retained legacy target fails health after durable writes
- **THEN** recovery stops that process, switches to the verified compatible previous release, reopens the latest state and verifies recovery without restoring an old database

The current TypeScript successor SHALL instead apply focused forward assessment and independent recovery eligibility under bunny-runtime-upgrades. Unknown recovery MUST NOT block its forward plan and MUST refuse recovery execution.

