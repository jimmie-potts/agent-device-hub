## Purpose

Define trustworthy early monitoring measurements and the evidence required to freeze performance budgets before shared runtime implementation.

## ADDED Requirements

### Requirement: Pinned real measurement boundaries
Source qualification SHALL identify exact released package and repository bytes, runtime versions, workload and measured boundaries. It SHALL measure real available implementation and report excluded or unavailable boundaries without substituting fake upstream services.

#### Scenario: Legacy admission only
- **WHEN** the legacy admission path is measured with worker launch excluded
- **THEN** the receipt identifies admission, transition and commit as measured and full hook return, actual Linux worker launch and rendering as unmeasured

#### Scenario: Changed source bytes
- **WHEN** a source or package digest differs from its accepted pin
- **THEN** qualification stops before executing that input and records a fixed failure without exporting private content

### Requirement: Repeated monotonic observations
Measurements SHALL retain raw samples, sample counts, cold/warm definitions, repeated 1/10/50-task profiles, per-repeat and pooled tail statistics and explicit resource/load evidence. Durations SHALL remain within one monotonic clock domain.

#### Scenario: Concurrent burst
- **WHEN** tasks enter a source boundary concurrently
- **THEN** the receipt preserves individual operation durations and burst makespan separately, including failed or timed-out repetitions

#### Scenario: Sparse tail samples
- **WHEN** a percentile has insufficient repeated samples for qualification
- **THEN** the receipt marks its support as provisional and does not claim a qualified product budget

### Requirement: Isolated bounded source execution
Qualification tooling SHALL bound execution and use synthetic neutral data in disposable Linux storage, without installed client sessions, private state, Windows executable/metadata access or physical operations. Full-hook qualification SHALL execute the real Linux entrypoint and actual Linux worker-spawn handoff under verified confinement. Admission-only launch stubs SHALL NOT establish full-hook coverage.

#### Scenario: Forbidden side effect
- **WHEN** an admission measurement attempts network, worker launch or a database outside its isolated directory
- **THEN** it fails with a fixed diagnostic and does not report a successful profile

#### Scenario: Full Linux hook
- **WHEN** the real hook processes synthetic stdin against explicit isolated Linux state
- **THEN** the receipt times process launch through hook exit, including parsing, admission/commit and actual Linux worker spawning, and reports background readiness/cleanup separately without claiming physical completion

#### Scenario: Detached descendant cleanup
- **WHEN** a full-hook run finishes, times out or fails after spawning a detached worker
- **THEN** qualification verifies descendant termination and no private state, external network or device access; unverified confinement or surviving descendants prevents a successful profile

#### Scenario: Worker timeout
- **WHEN** a measurement exceeds its explicit tool timeout
- **THEN** the worker and descendants are terminated and the timeout remains in the receipt rather than being excluded from statistics

### Requirement: Early budget delivery gate
Numeric p95/p99, hard timeout, CPU, memory, queue, cadence, sampling and tolerance budgets SHALL be frozen from reviewed comparable Linux observations before shared core implementation. Missing Linux hook coverage SHALL block early-stage delivery. Native Windows comparison and executable-forwarding measurements SHALL NOT be prerequisites. Future integrated measurements SHALL remain pending until their real implementations exist; queue/cadence constraints for the future feed SHALL NOT be reported as measured legacy behavior.

#### Scenario: Missing Linux hook evidence
- **WHEN** full required Linux hook coverage or reviewed numeric budgets are unavailable
- **THEN** preparation can continue but no accepted early budget receipt or downstream implementation readiness is claimed

#### Scenario: Windows forwarding unavailable
- **WHEN** no native Windows execution or forwarding route is available
- **THEN** Linux qualification can proceed without Windows comparison or bridge repair

#### Scenario: Historical admission receipts
- **WHEN** prior admission-only receipts use a different source pin
- **THEN** qualification preserves their provenance and excludes them from claims of current full Linux hook coverage

#### Scenario: Later failure exceeds a frozen budget
- **WHEN** integrated source measurements violate a delivered budget
- **THEN** qualification fails and budget changes require documented review rather than silent relaxation
