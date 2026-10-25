# portable-runtime-acceptance Specification

## Purpose
Enable independent runtime Acceptance on an existing container engine without a Linux user manager, retaining exact identity, synthetic isolation, bounded lifetime and verified owned cleanup.

## Requirements

### Requirement: Explicit isolated portable review

The runtime verification entrypoint SHALL offer an explicit finite portable operation. It MUST use a clean exact candidate, immutable test-image and container identities, synthetic private state and an in-container browser. It MUST publish no host port, use no external network, personal mount, installed volume, host namespace, device, privilege or container-engine socket, and preserve the runtime's simulated-transport guards.

#### Scenario: Clean offline review
- **WHEN** an independent reviewer selects an exact candidate and scenario on the existing qualified engine
- **THEN** the operation records its unique run, source, artifact, image and container identities and actual/simulated components
- **AND** the runtime and browser execute only inside that run's isolated container

#### Scenario: Candidate or boundary mismatch
- **WHEN** source is dirty or unknown, the image revision differs, the artifact changes or an effective isolation setting differs
- **THEN** the run cannot be accepted and only its exactly identified owned resources can be stopped

### Requirement: Finite independently enforced lifetime

The operation MUST arm a nonrenewable deadline before candidate/browser launch, independent of the host caller and application/capture event loop. Expiry MUST terminate the whole owned container process tree. It SHALL offer no detached preview, extension or handoff, and MUST NOT claim verified realtime expiry through host/VM suspension or inaccessible engine state.

#### Scenario: Caller disappears or application stalls
- **WHEN** the host caller terminates or the application/capture stalls
- **THEN** the prearmed deadline still ends the whole container without a caller-issued stop
- **AND** interrupted or unfinished observations cannot pass

#### Scenario: Engine is unavailable
- **WHEN** authoritative stop or resource readback cannot be obtained
- **THEN** cleanup is unknown, the operation cannot report success, and private state is retained until exact stopped ownership is reconciled

### Requirement: Inspectable observations and safe proof survival

The reviewer MUST directly exercise and assess relevant user-facing scenarios using shared asserted captures. A passed run MUST record exact source/artifact identity, completed assertions, valid finalized capture artifacts and no credential/content/path canaries in retained proof. Private synthetic state SHALL reside outside the candidate checkout and off temporary memory storage. The stopped container MUST survive until allowlisted proof is validated and copied to the canonical ignored proof root; wholesale runtime/config/log export is prohibited.

#### Scenario: Metadata-only connector journey
- **WHEN** synthetic selected Mac Codex root lifecycle input is published
- **THEN** the reviewer observes session/turn activity and finished notice in the actual dashboard, with normal browser admission/recovery
- **AND** child, compaction and unselected inputs are refused, private content/transcript canaries remain excluded, and bad token/source, read/control/admin and Host/Origin checks preserve their refusals
- **AND** unavailable or stalled receivers leave the producer silent and fail-open within its existing budget, without retries

#### Scenario: Failed or abandoned capture
- **WHEN** an assertion fails, a browser crashes or a capture is abandoned
- **THEN** it cannot count as a satisfied independent verdict
- **AND** failed/partial evidence remains attributable while unsafe or unfinished artifacts cannot be represented as finalized proof

### Requirement: Verified exact-owned cleanup and retained review gates

The operation MUST verify that its exact container is stopped before exporting proof or removing private state. Cleanup MUST distinguish removed/absent from left/unknown, preserve unrelated containers/files, and refuse a successful result when cleanup is unconfirmed. Existing systemd operations, receipts, independent reviewer separation and required CI/merge gates SHALL remain supported. A portable run is evidence for an independent verdict, never the verdict itself.

#### Scenario: Successful review cleanup
- **WHEN** captures complete and the exactly owned container is authoritatively stopped
- **THEN** validated allowlisted proof is retained, only that container/private state is removed, and authoritative absence is checked

#### Scenario: Wrong owner or unresolved cleanup
- **WHEN** run/image/container ownership mismatches or stop/removal cannot be confirmed
- **THEN** unrelated resources are untouched and the run remains unsuccessful with truthful retained-resource evidence

#### Scenario: Independent formal review
- **WHEN** an independent reviewer uses the documented alternative on a current clean candidate
- **THEN** its report identifies scenarios, observations, run IDs, limits and verified cleanup separately from installed-client evidence
- **AND** historical unsupported managed-route reports remain incomplete rather than being relabelled passed
