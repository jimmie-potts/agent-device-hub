## Purpose

Let the owner upgrade the established B.U.N.N.Y. TypeScript runtime and recover
to a qualified previous release while preserving the latest private durable state.

## Requirements

### Requirement: Exact owning procedure and plan

The current runtime SHALL provide an owning upgrade/recovery procedure for the
established installation. Its pre-effect plan MUST bind the candidate and previous
release identities, configuration, state owners, protected paths, operation scope,
restart effects, a focused storage-change assessment and explicit recovery eligibility. Existing scoped
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

#### Scenario: Stale operator request
- **WHEN** an operator supplies a request or plan using the superseded routine admission schema
- **THEN** new execution refuses it and requires a fresh request and plan without rewriting historical evidence

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

The current runtime SHALL assess actual storage changes using focused evidence before a forward upgrade, without requiring historical certificates for every owner or unchanged format. It MUST quiesce named writers and verify a consistent private backup before switching. Recovery eligibility SHALL be independent: unknown recovery MUST allow forward planning and MUST refuse recovery selection/checks. Qualified recovery MUST use the exact approved previous artifact and complete identity, reopen latest state with verified bytes and focused evidence for affected formats and selected owners, and remain representable by the unchanged receipt contract. No operation SHALL silently restore an older snapshot, replay commands or activate unselected modules. Snapshot restoration requires a separate explicit owner decision, preservation of the failed latest state and an honest data-gap report.

#### Scenario: Recovery format is unknown or incompatible
- **WHEN** a reviewed forward release has no qualified older reader
- **THEN** its otherwise valid forward plan is eligible, reports recovery as unknown and refuses a recovery check before selection

#### Scenario: Stored formats change
- **WHEN** the target changes a stored format or reader
- **THEN** the change assessment includes focused forward write/reopen evidence and independently states any qualified latest-state recovery evidence

#### Scenario: Stopping or backup fails
- **WHEN** a named writer remains active or a consistent backup cannot be verified
- **THEN** the procedure does not switch releases and records the observed state truthfully

#### Scenario: Candidate writes newer records before recovery
- **WHEN** recovery is selected after a candidate has written records or command outcomes
- **THEN** qualified recovery preserves that latest state without replay, and unknown/incompatible readers refuse rather than restoring older data

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
release MUST remain available; recovery eligibility MUST be reported independently. Deliberate live
recovery and re-upgrade SHALL NOT be required for initial qualification and MUST
be reported as untested unless separately exercised. A failed, refused or
interrupted forward upgrade MUST leave initial installed qualification pending,
even when an authorized recovery succeeds. Source checks and service health MUST
NOT stand in for actual-client or physical-device acceptance of dependent features.

#### Scenario: Synthetic rehearsal succeeds
- **WHEN** the disposable rehearsal exercises forward admission, running checks and recovery refusal with synthetic records
- **THEN** it establishes only the measured synthetic qualification, while established-installation acceptance remains pending

#### Scenario: Established runtime upgrade is verified
- **WHEN** the separately authorized single forward upgrade verifies its exact plan, stopped-writer backup, finalized receipt, running identity, required health and latest state while retaining the previous verified release and recording recovery eligibility
- **THEN** its installed acceptance can be recorded separately from dependent ONN client and physical outcomes, with deliberate live recovery and re-upgrade explicitly untested unless separately exercised

#### Scenario: Initial upgrade needs recovery
- **WHEN** the initial forward upgrade fails or is interrupted and inspection establishes that the exact approved plan calls for recovery
- **THEN** the coordinator performs at most one authorized compatible recovery on latest state, records the actual outcome and ends the window without re-upgrade or replay; initial installed qualification remains pending

### Requirement: Bounded absent ONN health qualification

The routine upgrade procedure SHALL recognize a reported ONN health row only when ONN is unconfigured, and that row has state `refused`, reason code `not-found` and `healthy: false`. Preflight and post-start verification MUST apply the same bounded exception while retaining every other source, state, health, ownership and recovery check. Configured ONN MUST NOT use this absence exception. Retained inactive state is inventoried and preserved without mandatory historical qualification. Unknown modules MUST remain outside the qualified profiles. The exception MUST NOT activate ONN or establish installed or physical acceptance.

#### Scenario: Shipped ONN is absent from the selected configuration
- **WHEN** the qualified configuration/state inspection finds no ONN configuration and ONN reports the exact refused/not-found/unhealthy row with the required degraded aggregate health
- **THEN** preflight and post-start health verification admit that exception only after their other gates pass

#### Scenario: ONN is configured or has retained state
- **WHEN** ONN configuration is present
- **THEN** ordinary running, healthy, null-reason module health is required

#### Scenario: ONN health does not describe the bounded absence
- **WHEN** ONN reports running, healthy, a different refusal reason or an inconsistent aggregate status
- **THEN** preflight and post-start verification refuse using their existing safe failure surfaces

#### Scenario: An unknown module is reported
- **WHEN** a health row names a module outside the explicitly qualified profile
- **THEN** verification refuses without treating that row as an absent ONN exception

#### Scenario: Qualified previous release does not report ONN
- **WHEN** an otherwise qualified previous release reports no ONN row and ONN is unconfigured
- **THEN** its existing health checks remain applicable without requiring a fabricated ONN row or certificate

### Requirement: Companion ownership and health remain explicit

The procedure SHALL inventory the companion owner's files with the same private ownership, type, link and permission checks as existing stores, without opening live databases. Configuration, sidecars or an owner directory without the primary companion store MUST NOT substitute for retained state. A selected artifact that ships the always-started owner MUST report ordinary running, healthy, null-reason module health. Preflight and post-start checks MUST enforce the same release-specific requirement. Post-start ownership MUST match the approved ownership plus only the qualified companion owner created by a release that ships it; other drift MUST refuse. This qualification MUST NOT authorize companion enablement, installed operations, model use, sensing, device commands or #643's desk acceptance.

#### Scenario: Private retained companion state is inspected
- **WHEN** regular companion database/sidecar files or its private module directory are inventoried
- **THEN** the owner is included without database reads or modification, while unsafe links, permissions and unsupported leases refuse

#### Scenario: First startup creates the qualified owner
- **WHEN** a qualified candidate first creates companion state under the unchanged approved configuration
- **THEN** post-start verification requires that owner and its ordinary healthy running row while preserving every other approved owner and input

#### Scenario: Companion health is unavailable or inconsistent
- **WHEN** an artifact shipping companions reports no row, duplicate rows, refused, stopped, unhealthy or non-null-reason health
- **THEN** preflight or post-start verification refuses without treating the row as an absent-device exception

#### Scenario: Startup changes unrelated ownership
- **WHEN** another owner appears or disappears, configuration changes, or companion state is missing after its qualified startup
- **THEN** post-start verification refuses instead of broadening the accepted profile

#### Scenario: Source checks pass while installation is unselected
- **WHEN** synthetic production-store and refusal checks pass
- **THEN** only source qualification is evidenced; exact installed startup authority and ONN client/physical acceptance remain separate

### Requirement: Routine forward admission preserves inactive owners

Routine forward admission SHALL require verified previous/target releases, installed baseline protection, a focused change assessment and the existing lock, private-input, state-layout, health and receipt checks. It MUST NOT require broad source-format requalification, fixed owner phase certificates, a third recovery release or execution of inactive integrations. Known retained inactive owners SHALL remain inventoried and preserved. Unknown owners, unsafe files, configured missing primary stores and unhealthy configured modules MUST still refuse.

#### Scenario: Hibernated integration data remains
- **WHEN** the installation retains inactive BB-8 files and the new release omits its compiled readers
- **THEN** the otherwise valid forward plan includes that ownership without running dormant code, reading a Windows database or requiring BB-8 phase certificates

#### Scenario: Recovery evidence is independently bound
- **WHEN** the original previous release is qualified for recovery
- **THEN** its exact artifact paths, complete verified identity and private latest-state evidence are bound to the reviewed request and any drift refuses

#### Scenario: A different recovery release cannot finalize this operation
- **WHEN** recovery names artifact paths or a complete verified identity different from the original previous release
- **THEN** the request or pre-effect recovery check refuses without effects; the original receipt identity remains unchanged and another release needs a separately assessed operation
