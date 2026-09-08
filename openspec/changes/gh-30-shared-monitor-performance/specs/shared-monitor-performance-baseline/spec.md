## Purpose

Define trustworthy early monitoring measurements and the evidence required to freeze performance budgets before shared runtime implementation.

## ADDED Requirements

### Requirement: Pinned real measurement boundaries
Source qualification SHALL identify exact released package and repository bytes, runtime versions, workload and measured boundaries. It SHALL measure real available implementation and report excluded or unavailable boundaries without substituting fake upstream services.

#### Scenario: Legacy admission only
- **WHEN** the legacy admission path is measured with worker launch excluded
- **THEN** the receipt identifies admission, transition and commit as measured and full hook return, helper forwarding and rendering as unmeasured

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
Qualification tooling SHALL bound execution and use synthetic neutral data in disposable native storage, without installed client sessions, private state or physical operations.

#### Scenario: Forbidden side effect
- **WHEN** an admission measurement attempts network, worker launch or a database outside its isolated directory
- **THEN** it fails with a fixed diagnostic and does not report a successful profile

#### Scenario: Worker timeout
- **WHEN** a measurement exceeds its explicit tool timeout
- **THEN** the worker is terminated and the timeout remains in the receipt rather than being excluded from statistics

### Requirement: Early budget delivery gate
Numeric p95/p99, hard timeout, CPU, memory, queue, cadence, sampling and tolerance budgets SHALL be frozen from reviewed matched Windows/WSL observations before shared core implementation. Missing required paths SHALL block early-stage delivery. Future integrated measurements SHALL remain pending until their real implementations exist.

#### Scenario: Inaccessible Windows route
- **WHEN** matched Windows evidence or full required hook/helper coverage is unavailable
- **THEN** available preparation can continue but no accepted early budget receipt or downstream implementation readiness is claimed

#### Scenario: Later failure exceeds a frozen budget
- **WHEN** integrated source measurements violate a delivered budget
- **THEN** qualification fails and budget changes require documented review rather than silent relaxation
