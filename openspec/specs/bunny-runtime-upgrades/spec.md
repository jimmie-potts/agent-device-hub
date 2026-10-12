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

### Requirement: Bounded absent ONN health qualification

The routine upgrade procedure SHALL recognize a reported ONN health row only when ONN is unconfigured, no ONN state is retained, and that row has state `refused`, reason code `not-found` and `healthy: false`. Preflight and post-start verification MUST apply the same bounded exception while retaining every other source, admission, state, health, ownership and recovery check. Configured or retained ONN MUST NOT use this absence exception; it requires the separately bound configured/retained ONN qualification. Unknown modules MUST remain outside the qualified profiles. The exception MUST NOT activate ONN or establish installed or physical acceptance.

#### Scenario: Shipped ONN is absent from the selected configuration
- **WHEN** the qualified configuration/state inspection finds no ONN configuration or retained state and ONN reports the exact refused/not-found/unhealthy row with the required degraded aggregate health
- **THEN** preflight and post-start health verification admit that exception only after their other gates pass

#### Scenario: ONN is configured or has retained state
- **WHEN** ONN configuration or any retained ONN state is present
- **THEN** the unqualified owner is refused without opening, modifying or removing its database or files

#### Scenario: ONN health does not describe the bounded absence
- **WHEN** ONN reports running, healthy, a different refusal reason or an inconsistent aggregate status
- **THEN** preflight and post-start verification refuse using their existing safe failure surfaces

#### Scenario: An unknown module is reported
- **WHEN** a health row names a module outside the explicitly qualified profile
- **THEN** verification refuses without treating that row as an absent ONN exception

#### Scenario: Qualified previous release does not report ONN
- **WHEN** an otherwise qualified previous release reports no ONN row and no ONN configuration or state exists
- **THEN** its existing health/admission checks remain applicable without requiring a fabricated ONN row or changing the legacy seven-owner certificate format

### Requirement: Configured and retained BB-8 qualification

The established-runtime procedure SHALL admit configured or retained BB-8 only
with coordinator-bound compatibility coverage for its latest production state,
accepted responsibility, SDK outbox and independently owned Windows receipts.
Storage-bearing Windows helper inputs MUST participate in conservative format
classification. Recovery and re-upgrade MUST preserve latest durable evidence
without replaying any robot operation, changing enrollment or opening the
Windows receipt database from WSL. Configured BB-8 MUST satisfy ordinary running
module health; an absent-module exception SHALL apply only when unconfigured.
Admission SHALL preserve the separately qualified boundaries for all other
modules. Source qualification MUST NOT establish installation or physical
acceptance.

Admission MUST preserve the legacy seven-owner coverage shape. Configured or
retained BB-8 MUST require the complete `bb8` and `bb8-windows` pair, each with
`baseline`, `candidate`, `recovery` and `reupgrade` evidence. A partial pair or
missing phase MUST refuse; a seven-owner certificate MUST NOT admit configured
or retained BB-8.

#### Scenario: Configured or retained BB-8 has complete compatible evidence
- **WHEN** the selected releases have complete bound production-store recovery and re-upgrade evidence for configured or retained BB-8
- **THEN** the read-only plan includes BB-8's durable ownership and admits it only with the required configured-module health

#### Scenario: Latest BB-8 state survives recovery
- **WHEN** a disposable candidate commits LED intent, reported power, interrupted responsibility and completed outcomes before compatible recovery and re-upgrade
- **THEN** every latest record remains readable, interrupted effects remain uncertain or failed as appropriate, and no robot operation replays

#### Scenario: Windows helper storage-bearing input changes
- **WHEN** a selected helper input differs between the qualified and candidate releases
- **THEN** format classification requires renewed compatibility evidence rather than treating the change as documentation or operator-only work

#### Scenario: Missing coverage or unhealthy configured BB-8
- **WHEN** BB-8 is configured or retained without complete compatible evidence, or its configured module is refused, stopped or unhealthy
- **THEN** admission refuses before any service, mutable state or device effect

#### Scenario: Unconfigured BB-8 remains absent
- **WHEN** BB-8 is unconfigured and its health row is refused with not-found and healthy false
- **THEN** the existing bounded absent-module exception remains available without activating the module or contacting a robot

#### Scenario: Legacy coverage remains available without selected BB-8
- **WHEN** no BB-8 configuration or retained state is selected and the original seven-owner certificate has complete matching source, format and phase bindings
- **THEN** that coverage shape remains accepted without requiring either additional BB-8 owner

#### Scenario: Qualified BB-8 coexists with absent ONN
- **WHEN** configured or retained BB-8 has its complete paired evidence and ONN is unconfigured without retained state, with its exact refused/not-found/unhealthy health row
- **THEN** initial and post-start checks preserve the BB-8 coverage requirement and the separately qualified ONN absence boundary together

### Requirement: Configured and retained ONN upgrade qualification

The fixed production upgrade profile SHALL accept the selected ONN configuration
and private durable state only with complete ONN baseline, candidate,
compatible-recovery and re-upgrade qualification bound to the actual release
and format identities. Existing seven-owner and paired BB-8 certificates SHALL
remain valid for their qualified scopes. Unknown owners, missing coverage,
unsafe entries and incompatible recovery SHALL refuse before service effects.

#### Scenario: ONN is configured or retained
- **WHEN** ONN is configured or any selected ONN durable state remains
- **THEN** preflight requires complete bound ONN qualification and configured ONN must report running, healthy, reason-free state

#### Scenario: ONN coverage is missing or incomplete
- **WHEN** ONN is configured or retained but its four qualification phases are missing, duplicated, unbound or incompatible
- **THEN** preflight refuses before any service stop, release selection or device command

#### Scenario: ONN is absent
- **WHEN** ONN is unconfigured with no retained state and reports refused, not-found and unhealthy
- **THEN** the existing absent-ONN exception remains valid and requires no ONN coverage; running, healthy, wrong-reason or unknown states still refuse

#### Scenario: Candidate writes title observations and command outcomes
- **WHEN** the synthetic candidate writes title originals, gaps, reported progress, request identities, fences and outcomes before compatible recovery and re-upgrade
- **THEN** each separate process retains those latest records and private identities, settles interrupted responsibility truthfully, and never re-executes an earlier device command

#### Scenario: Recovery predates enabled history
- **WHEN** a proposed recovery cannot parse the selected history configuration or reopen its retained formats
- **THEN** qualification refuses that recovery rather than stripping settings, restoring older data or treating source tests as installed acceptance
