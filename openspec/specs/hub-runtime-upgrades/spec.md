# Hub runtime upgrades

## Purpose

Give the installation owner an inspectable Hub upgrade and rollback command that preserves shared runtime paths and the latest durable state under the published install contract.

## Requirements

### Requirement: Read-only plan and explicit operation approval

The Hub updater SHALL provide `plan`, `status`, `upgrade` and `rollback`. Plan and status MUST distinguish installed, running and remote identities without changing the installation. An operation MUST bind its reviewed plan digest to the full merged target, complete change bundle, baseline, configuration, named service, outage, backup and recovery route, and recheck these inputs under an exclusive installation lock. The coordinator MUST verify applicable owner authority for that exact operation; scoped standing installation authority requires no renewed human approval.

#### Scenario: Changed or concurrent baseline
- **WHEN** the approved baseline or configuration changes, another operation holds the lock, or an unresolved operation remains
- **THEN** execution refuses before service stop and retains an inspectable reason without blind replay

#### Scenario: Inactive or unavailable identity
- **WHEN** the service is inactive or remote comparison cannot be read
- **THEN** status reports no current running identity or an unknown remote comparison respectively, without claiming installation success

### Requirement: Trusted release and compatible recovery

Every new target MUST have a clean merged full source identity, trusted archive and manifest hashes, verified safe inventory and dependency closure. Before outage, the command MUST prove previous-release compatibility with all durable data the target can write using format evidence and an isolated write/reopen test. Unknown or incompatible recovery MUST refuse.

Format evidence SHALL require the durable surface of the installer, the previous release and the target to be byte-identical, ignoring file modes. The durable surface is the Hub storage adapter, automation store and automation modules and the validators they apply to stored rows; any other Hub module that imports `node:sqlite` apart from the named read-only state capture and migration lease; the agent-state durable validator and identity-key modules; every agent-state schema except snapshot schemas; every lifecycle module; and the lifecycle 1.0 and 1.1 schemas. Agent-state and lifecycle files that the updater does not classify as non-durable MUST count as durable. Reducer, provider, retention, snapshot, coordination and constants modules and newer lifecycle schema files are outside the surface. Because the Hub imports the durable validator through the agent-state entrypoint, the write/reopen test MUST require that entrypoint to export the fingerprinted validator functions in both releases. The test MUST cover the stored session metadata and a known parent as well as the existing record kinds.

#### Scenario: Provenance or compatibility refusal
- **WHEN** source is dirty, archive bytes differ, a path escapes its release, same-SHA bytes conflict or recovery compatibility is unknown
- **THEN** the command refuses without stopping the installed owner

#### Scenario: Latest durable records survive recovery
- **WHEN** the target writes newer identities, revisions, labels, notices, acknowledgments, rules, settings or consumed-event history and recovery runs
- **THEN** the previous program reopens the latest state without restoring an older database or repeating consumed effects

#### Scenario: Content change with unchanged storage
- **WHEN** the target changes only reducer, coordination or constants code, edits or adds snapshot schemas, or adds a lifecycle schema file
- **THEN** format evidence passes, the target-write/previous-reopen test passes in both upgrade and rollback directions, and qualification is compatible

#### Scenario: Durable surface change
- **WHEN** a stored-state schema, a lifecycle 1.0 or 1.1 schema, a lifecycle module, a storage or validator module, an unclassified package module or schema file, or a new Hub SQLite module differs
- **THEN** qualification reports `durable-implementation-unqualified` without executing the changed code, and the operation refuses before stop

#### Scenario: Entrypoint rebinds the durable validator
- **WHEN** either release's agent-state entrypoint exports a validator function other than the one in its durable validator module
- **THEN** qualification reports `durable-reopen-probe-failed` and the operation refuses before stop

#### Scenario: Target leaks a field into storage
- **WHEN** the target's content code writes a session field that the stored-state schema rejects on a path the write/reopen test exercises
- **THEN** qualification reports `durable-reopen-probe-failed` and the operation refuses before stop

#### Scenario: Durable dependency unavailable
- **WHEN** a package, required storage or validator module, or required schema is missing or unreadable in any compared program
- **THEN** qualification reports `durable-implementation-unavailable` and the operation refuses before stop

#### Scenario: Refusal reason is inspectable
- **WHEN** qualification refuses an upgrade or rollback
- **THEN** the refused receipt reports `install-rollback-unqualified` and the operation's evidence file records the specific qualification reason

### Requirement: Shared-path preserving first adoption

First adoption SHALL retain verified existing bytes and replace only the Hub stable component with the contract's forwarding/current-link layout. A hash-identified legacy recovery copy is allowed only for the existing installation. The shared runtime parent, Node executable, Nanoleaf paths, hooks, units and historical backups MUST remain unchanged. Interrupted or unverifiable adoption MUST require inspection.

#### Scenario: Either adoption order
- **WHEN** isolated Hub-first or Nanoleaf-first fixtures migrate, upgrade, recover and re-upgrade
- **THEN** the other runtime and shared executable retain identical bytes and resolution, and neither pruner follows the other's paths

#### Scenario: Legacy health without build metadata
- **WHEN** rollback selects the qualified legacy copy whose health lacks build identity
- **THEN** verification combines process start and executable/entrypoint resolution with served-artifact and operational evidence, rather than requiring a nonexistent field

### Requirement: Bounded switching and truthful recovery outcomes

The updater MUST durably record intent, stop and verify its named writer, take a consistent backup excluding transient objects, atomically switch the Hub anchor and verify bounded running identity and operational health. Candidate failure SHALL attempt only the prequalified recovery route against latest durable state. Failed rollback or receipt finalization MUST remain an explicit failure requiring inspection.

#### Scenario: State inspection with an active owner
- **WHEN** verification reads state after starting the candidate or recovery program
- **THEN** it MUST first verify the whole service is paused, bound the isolated read, attempt resumption even on failure and recheck health after resumption
- **AND** it MUST accept supported owner edits and retention while rejecting backward revisions, lost unexpired records or unexplained deduplication loss

#### Scenario: Failed health and recovery
- **WHEN** the candidate fails its bounded health check
- **THEN** it is stopped before recovery starts, and the receipt distinguishes verified recovery from failed or unknown recovery

#### Scenario: Final receipt cannot be persisted
- **WHEN** the final durable receipt write fails after restart
- **THEN** the operation reports failure with a diagnostic outcome, retains inspectable intent and performs no pruning or automatic retry

### Requirement: Private evidence and owned retention

Receipts MUST satisfy `install-receipt/1.0` including its semantic validator. Retention SHALL keep current plus the three prior successful owned releases and protect referenced recovery targets, legacy copies, receipts, backups and every other runtime. Logs and public evidence MUST exclude credentials and private state contents.

#### Scenario: Safe retention
- **WHEN** successful finalization makes an old release eligible for pruning
- **THEN** only unreferenced Hub releases are removed and all protected paths remain unchanged

### Requirement: Discoverable installation checkpoint

Root agent instructions SHALL state installation completion and its source-only batching exception, require a coordinator checkpoint against applicable owner authority before effects, and point to one setup procedure that requires plan before installation or rollback. Source tests MUST remain distinct from the real approved migration, upgrade, rollback and re-upgrade acceptance.

#### Scenario: Root-launched upgrade request
- **WHEN** a fresh agent receives an installed-Hub upgrade request
- **THEN** it reads the setup procedure, runs plan and reviews the exact sequence against existing authority; it proceeds without renewed approval within standing scope and stops only for effects outside that scope or other unmet gates

### Requirement: Optional unattended transition deadline

Upgrade and rollback MAY accept an explicit finite deadline. When supplied, the native operation SHALL require at least 600 seconds remaining before entering its operation and immediately before durable mutation intent, after staging and compatibility checks. Insufficient reserve SHALL refuse before service stop. An admitted switch and recovery SHALL retain the existing native completion path rather than be killed at the admission deadline. Plan and status SHALL reject a mutation deadline argument; ordinary authorized manual operations without it SHALL keep their existing behavior.

#### Scenario: Staging exhausts transition reserve
- **WHEN** a deadline-bound operation has enough reserve at entry but less than 600 seconds immediately before mutation intent
- **THEN** it produces a refusal without stopping or switching the service

#### Scenario: Invalid deadline argument
- **WHEN** a non-finite deadline is supplied, or plan/status receives a mutation deadline
- **THEN** argument validation rejects it without operating on the installation
