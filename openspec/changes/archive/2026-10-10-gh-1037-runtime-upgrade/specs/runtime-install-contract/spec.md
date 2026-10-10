## ADDED Requirements

### Requirement: Current runtime successor installation
The current TypeScript runtime SHALL use install-receipt/1.0 with logical runtime
`hub` and a distinct configured installationId. Its owning procedure SHALL declare
the private release root, atomic current anchor, bunny-runtime.service, external
state/configuration and Node executable. A separately authorized first adoption
MAY change the unit's release paths once; routine upgrades SHALL leave the unit,
hooks, mutable state paths, credentials and shared executable unchanged. Current
runtime verification SHALL use its own build and operational interfaces rather
than the retained Hub installer.

#### Scenario: First adoption is distinct from routine switching
- **WHEN** the existing service directly names a release checkout
- **THEN** the exact adoption plan names its single unit override, verified
  baseline, restart effects and recovery, and execution requires applicable
  authority covering those effects

#### Scenario: Routine release selection
- **WHEN** an adopted installation upgrades to a qualified release
- **THEN** only its owned atomic current anchor selects the release, the service
  unit and external state paths remain unchanged, and identity, health, latest
  state preservation and durable receipts are verified

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
