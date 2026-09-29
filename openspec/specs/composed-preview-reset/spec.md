# Composed preview reset Specification

## Purpose

Return a disposable Hub, Nanoleaf and Pixoo composition to its paired initial state while preserving run ownership, private pairing and frozen verification proof.

## Requirements

### Requirement: Ordered aggregate reset

`verify:compose -- reset <composition-id>` SHALL pause new outbound consumer-to-Hub requests and obtain evidence that every recorded consumer has drained in-flight requests before reseeding the Hub owner. Consumer pages and local controller operations SHALL stay available during the owner reseed. The Hub SHALL keep its integrated role and recorded pairing inputs. Only after that reseed succeeds SHALL each consumer reseed its paired scenario and resume against the new owner. Success SHALL require every ordinary composition readiness check to pass with consumer feeds current at the new owner revision. This implements Hub #557's paired starting-state criterion.

#### Scenario: Reset after state changes
- **WHEN** a running composition has changed from its seeded state and the owner resets it
- **THEN** all three runs return to their paired initial state, consumer feeds accept the new owner's revision even when it is lower, and composition readiness passes

#### Scenario: In-flight consumer request
- **WHEN** one consumer still has an unfinished Hub request
- **THEN** owner reseeding does not begin until both consumers acknowledge drained requests and both acknowledgments still belong to their current live processes

### Requirement: Verified pause and release ownership

A reset SHALL accept only bounded private regular control files for the recorded run and fresh operation nonce. Acknowledgment evidence SHALL match the current receipt and live process identity and a valid current lease. Missing, invalid, linked, stale or mismatched controls SHALL NOT authorize owner reseeding or consumer release. After owner success, each release SHALL name that consumer's same pause request and authorize its existing stopped-process seed transition only. Pairing credentials SHALL never be included in result or diagnostic output.

#### Scenario: Stale acknowledgment
- **WHEN** an acknowledgment names another run, nonce or process, or the recorded unit has restarted, expired or become unavailable
- **THEN** the reset fails without reseeding the owner on that evidence

#### Scenario: Consumer release after owner failure
- **WHEN** the Hub owner fails to reseed
- **THEN** no consumer receives release authorization and remaining live consumer feeds stay paused until cleanup

### Requirement: Aggregate operation exclusion and failure recovery

Aggregate operations that can affect runs or initiate readiness probes SHALL serialize for one composition. A live holder SHALL NOT be displaced, and an interrupted holder SHALL NOT prevent later cleanup. Reset SHALL record its phase and affected service before changing them and clear earlier successful readiness evidence. An unsuccessful or interrupted reset SHALL report the known per-service state, identify its failing phase and service where known, and remain cleanable through `stop`. It SHALL NOT silently resume an unreseeded consumer, repeat a command or report the old readiness as current. A replacement composition SHALL require cleanup of the earlier composition first.

#### Scenario: Another operation during reset
- **WHEN** another reset, diagnostic probe, capture, injection, handoff, lease extension or stop overlaps a reset
- **THEN** it waits for exclusive access or returns a bounded busy result without racing the reset

#### Scenario: Partial reset failure
- **WHEN** reset fails while pausing, reseeding the owner, reseeding either consumer or checking readiness
- **THEN** the result names the failed phase and service where known, does not claim readiness, and stop attempts cleanup of every recorded run with the owner first

#### Scenario: Interrupted reset
- **WHEN** the reset process exits after recording a phase
- **THEN** later diagnostics expose the incomplete state and stop recovers its operation lock and cleans the recorded runs

### Requirement: Stable run identity and retained proof

Reset SHALL preserve the composition identity, run identifiers, recorded ports and endpoint addresses, pairing token files and frozen proof bytes. It SHALL retain one authoritative Hub owner and the consumers' existing simulated or refused device boundaries. Success and failure SHALL preserve the lease-safe thaw and cleanup behavior. The separate handoff operation SHALL retain its existing proof-freezing behavior.

#### Scenario: Frozen captures survive reset
- **WHEN** a composition with frozen captures resets successfully or fails midway
- **THEN** the frozen manifests and artifacts still match their prior checksums

#### Scenario: Repeated reset
- **WHEN** a successfully reset composition resets again
- **THEN** it uses fresh pause authorization, returns to the same paired initial state on the same recorded ports and tokens, and does not add another owner
