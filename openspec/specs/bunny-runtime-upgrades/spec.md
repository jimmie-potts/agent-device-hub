## Purpose

Let the owner upgrade the established B.U.N.N.Y. TypeScript runtime and recover
to a qualified previous release while preserving the latest private durable state.

## Requirements

### Requirement: Exact owning procedure and plan

The current runtime SHALL provide an owning upgrade/recovery procedure for the
established installation. Its pre-effect plan MUST bind the candidate and previous
release identities, configuration, state owners, protected paths, operation scope,
restart effects, compatibility evidence and recovery procedure. Existing scoped
standing authority SHALL satisfy the authorization checkpoint. The procedure
MUST refuse unknown targets, changed inputs and effects outside that authority.

#### Scenario: Established installation has an authorized reviewed candidate
- **WHEN** the owner-authorized delivery has a reviewed merged candidate with successful applicable CI
- **THEN** its coordinator can review the exact plan and execute the owning procedure without a renewed permission request for routine authorized effects

#### Scenario: Plan inputs changed
- **WHEN** the baseline, candidate bytes, configuration, state ownership or protected paths differ from the reviewed plan
- **THEN** execution refuses before stopping any writer or changing the installation and requires a fresh plan

#### Scenario: Operational choices changed
- **WHEN** the backup destination, verification bounds, startup-effects authority or first-adoption override/restoration paths change
- **THEN** the canonical operation plan changes and the locked comparison refuses the previous plan before any effect

#### Scenario: Legacy installer selected for current runtime
- **WHEN** an operator attempts to satisfy this procedure with the retained Hub installer or repeats fresh cutover against current state
- **THEN** the procedure refuses that execution path and preserves current state and unrelated services

### Requirement: Verified release and exclusive operation

The procedure MUST verify clean merged source, dependency closure and release
bytes against trusted release evidence before effects. It MUST retain verified
previous bytes, acquire an exclusive installation-operation lock and persist
durable private intent before stopping the named runtime owner. Another active
operation or unresolved interrupted operation MUST prevent a new mutation.

#### Scenario: Candidate or recovery bytes are unverified
- **WHEN** source identity, build provenance, manifest, dependencies or recoverable previous bytes cannot be verified
- **THEN** the operation refuses before stopping the runtime and makes no successful installation claim

#### Scenario: Competing or interrupted operation
- **WHEN** another operation holds the installation lock or a prior intent requires inspection
- **THEN** the new operation refuses without stealing ownership or replaying effects

### Requirement: Latest durable state survives compatible recovery

The procedure MUST prove compatibility for every selected production durable
store and permanent referenced file before effects. It MUST quiesce the named
writers before taking a consistent private backup. Recovery SHALL reopen the
latest durable state with qualified previous bytes; it MUST NOT silently restore
an older database, resend a device command or activate unselected modules.
Unknown or incompatible recovery MUST refuse before stopping a writer.

#### Scenario: Candidate writes newer records before recovery
- **WHEN** a synthetic candidate writes identifiable preferences, history, retained media references and command outcomes and the previous release is selected for recovery
- **THEN** recovery and re-upgrade retain those latest records and referenced originals while producing no replay of admitted device commands

#### Scenario: Recovery format is unknown or incompatible
- **WHEN** the previous release cannot be proved to reopen the candidate's selected durable formats
- **THEN** the operation refuses before a service stop, release switch or mutable-state write

#### Scenario: Stopping or backup fails
- **WHEN** a named writer remains active or a consistent backup cannot be verified
- **THEN** the procedure does not switch releases and records the observed state and remaining recovery work truthfully

### Requirement: Running identity and truthful durable result

Completion MUST require the expected running process, startup revision,
operational health, latest-state preservation and a finalized durable private
receipt under the shared install contract. Any selected health exception MUST
remain explicit and bounded to its accepted evidence. An interrupted operation,
failed verification or failed receipt finalization MUST remain unsuccessful and
require inspection before another effect. Credentials and personal observations
MUST stay out of receipts intended for publication and all GitHub surfaces.

#### Scenario: Service is active with the wrong revision or failed health
- **WHEN** the service manager reports active but startup build identity or required health does not match the plan
- **THEN** installation remains unsuccessful and only the named qualified recovery procedure can establish recovered identity, health and state

#### Scenario: Final receipt persistence fails
- **WHEN** running verification succeeds but durable receipt finalization fails
- **THEN** the operation reports failure, retains its inspectable intent and performs no blind retry or pruning

#### Scenario: Visible terminal receipt has not been synchronized
- **WHEN** receipt replacement is visible but directory synchronization or readback fails
- **THEN** finalization reports failure through the private diagnostic channel and an identical persistence retry cannot report success without synchronization and exact readback

#### Scenario: Inspected interrupted operation is resolved
- **WHEN** the authorized coordinator verifies the actual selection, running identity, health and latest state under the held lock after an interruption
- **THEN** an explicit resolution binds the exact unresolved receipt and original approval frame, retains prior evidence and permits truthful finalization without replaying effects

### Requirement: Separate synthetic and established-installation acceptance

The procedure MUST have disposable synthetic upgrade, recovery and re-upgrade
evidence plus pre-effect refusal evidence. Its established-installation acceptance
MUST independently verify the exact plan, private receipt, running revision,
health and preserved state. Source checks and service health MUST NOT stand in
for actual-client or physical-device acceptance of dependent features.

#### Scenario: Synthetic rehearsal succeeds
- **WHEN** the disposable rehearsal preserves production-adapter records and refuses an incompatible candidate before effects
- **THEN** it establishes only the measured synthetic qualification, while established-installation acceptance remains pending

#### Scenario: Established runtime upgrade is verified
- **WHEN** the authorized established-installation operation verifies its plan, result, running identity, health and current state
- **THEN** its installed acceptance can be recorded separately from dependent ONN client and physical outcomes
