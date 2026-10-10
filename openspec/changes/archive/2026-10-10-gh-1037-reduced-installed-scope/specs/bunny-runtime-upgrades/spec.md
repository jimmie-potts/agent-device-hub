## MODIFIED Requirements

### Requirement: Separate synthetic and established-installation acceptance

The procedure MUST have disposable synthetic upgrade, recovery and re-upgrade
evidence plus pre-effect refusal evidence. Initial established-installation
acceptance MUST independently verify one separately authorized successful forward
upgrade: its exact plan, stopped-writer private backup, finalized durable receipt,
running revision, required health and preserved latest state. The previous verified
release and compatible recovery path MUST remain available. Deliberate live
recovery and re-upgrade SHALL NOT be required for initial qualification and MUST
be reported as untested unless separately exercised. A failed, refused or
interrupted forward upgrade MUST leave initial installed qualification pending,
even when an authorized recovery succeeds. Source checks and service health MUST
NOT stand in for actual-client or physical-device acceptance of dependent features.

#### Scenario: Synthetic rehearsal succeeds
- **WHEN** the disposable rehearsal preserves production-adapter records and refuses an incompatible candidate before effects
- **THEN** it establishes only the measured synthetic qualification, while established-installation acceptance remains pending

#### Scenario: Established runtime upgrade is verified
- **WHEN** the separately authorized single forward upgrade verifies its exact plan, stopped-writer backup, finalized receipt, running identity, required health and latest state while retaining the previous verified release and compatible recovery path
- **THEN** its installed acceptance can be recorded separately from dependent ONN client and physical outcomes, with deliberate live recovery and re-upgrade explicitly untested unless separately exercised

#### Scenario: Initial upgrade needs recovery
- **WHEN** the initial forward upgrade fails or is interrupted and inspection establishes that the exact approved plan calls for recovery
- **THEN** the coordinator performs at most one authorized compatible recovery on latest state, records the actual outcome and ends the window without re-upgrade or replay; initial installed qualification remains pending
