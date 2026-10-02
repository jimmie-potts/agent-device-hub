## Purpose

Qualify shared diagnostics through an isolated synthetic Hub command path, retaining enough evidence to judge ingestion, privacy, failure behavior and measured overhead before broader adoption.

## ADDED Requirements

### Requirement: Real command semantics remain authoritative

The pilot SHALL exercise the authenticated Hub brightness route and native controller ticket admission using isolated synthetic state and a fake controller. Enabling or failing diagnostics MUST NOT change authentication, admission, replay, retry policy or command outcomes. Queue admission, execution and terminal observations MUST remain distinct.

#### Scenario: Successful and rejected commands
- **WHEN** synthetic valid and invalid brightness commands traverse the Hub
- **THEN** their diagnostic records identify the appropriate operation and outcome while their domain responses match diagnostics-disabled behavior

#### Scenario: Duplicate and concurrent commands
- **WHEN** duplicate tickets and concurrent requests are submitted
- **THEN** an independent execution oracle proves no duplicate side effect and diagnostic context does not cross between operations

#### Scenario: Timeout after admission
- **WHEN** the fake controller admits a command but its response times out
- **THEN** the caller retains an uncertain outcome, no automatic command retry occurs, and later execution evidence is distinguished from the original response

### Requirement: Shared fields survive actual backend ingestion

The pilot SHALL consume the immutable released diagnostic artifact with verified checksum and source receipt. Node and Python records SHALL retain the shared versioned form and queryable resource, event, severity, correlation and typed attribute fields through local structured output and backend ingestion. Logs SHALL have exactly one Collector ingestion path. Trace/log correlation SHALL be demonstrated through actual queries and the existing viewer.

#### Scenario: Mixed-language correlated query
- **WHEN** synthetic Node and Python records and their corresponding traces are exported
- **THEN** saved backend queries retrieve the expected identities and typed fields without parsing message text, and the viewer links a trace to its logs

#### Scenario: Missing backend record
- **WHEN** an expected healthy record is absent after the frozen query-visibility deadline
- **THEN** export acknowledgment alone cannot satisfy the ingestion check and the missing identity remains in the result evidence

### Requirement: Privacy and propagation are constrained

The pilot MUST emit only static registered diagnostic content and typed allowlisted metadata. It MUST exclude credentials, real content, session/project identity, raw paths/URLs, exception text/stacks and arbitrary payloads from both local and exported records. Only authenticated owned boundaries SHALL accept validated traceparent; baggage and tracestate MUST NOT propagate. Vendor or device endpoints MUST receive no tracing traffic.

#### Scenario: Adversarial synthetic content
- **WHEN** synthetic secrets appear in headers, query strings, payloads and errors
- **THEN** local output and backend queries contain none of those values while allowed operation metadata remains available

#### Scenario: Untrusted context
- **WHEN** an unauthenticated request or malformed trace context reaches the Hub
- **THEN** authentication and domain outcomes remain unchanged and untrusted context is not adopted

### Requirement: Telemetry fails within fixed bounds

Records MUST be no larger than 8 KiB. Each signal SHALL have a maximum of 1,024 queued records and 4 MiB, with the first reached limit enforced. Overflow SHALL drop newest records with bounded safe counters. The pilot SHALL exercise absent and paused collection, queue saturation and export errors. It MUST account for loss and preserve command outcomes. Flush SHALL complete or abandon pending telemetry within one second; application shutdown after workload quiescence SHALL finish within two seconds.

#### Scenario: Unavailable collection
- **WHEN** collection remains unavailable during command execution
- **THEN** telemetry remains within both queue limits, losses and pending records are accounted for, and command results and side effects match the disabled baseline

#### Scenario: Shutdown with queued telemetry
- **WHEN** the quiescent application shuts down while export is stalled
- **THEN** bounded flush and shutdown deadlines hold and evidence reports unexported records without retrying device commands

### Requirement: Qualification is isolated and resource bounded

The pilot SHALL use pinned backend inputs, loopback-only listeners, fake credentials and disposable synthetic state. It MUST reserve at least 8 GiB host-available RAM, hard-limit the stack to two CPUs and 4 GiB RAM, and limit image storage to 10 GiB and run data to 2 GiB. It MUST stop on a resource-cap breach. Cleanup SHALL remove only run-owned resources and complete container teardown within 30 seconds while preserving synthetic evidence.

#### Scenario: Resource or prerequisite failure
- **WHEN** a required runtime is unavailable or a hard cap is breached
- **THEN** the affected qualification remains unexecuted or failed, evidence is retained, and source tests do not substitute for the missing runtime result

#### Scenario: Cleanup ownership
- **WHEN** a pilot run finishes or fails
- **THEN** its manifest identifies retained evidence and removed resources, and unrelated services, images and state remain untouched

### Requirement: Benchmarks use frozen acceptance rules

Before measurement, the pilot SHALL freeze and checksum its protocol, revisions and thresholds. It SHALL run three disabled/enabled pairs for each of healthy and unavailable collection, using 20 operations per second, concurrency at most eight, 30 seconds warm-up and 60 seconds measurement. Every pair MUST meet added p50 latency ≤max(2 ms, 10% baseline), added p95 ≤max(5 ms, 15%), throughput ≥95% baseline, application CPU increase ≤0.25 core and peak RSS increase ≤64 MiB. Stack peak RSS MUST be ≤3 GiB and mean CPU ≤1 core. Healthy expected loss, privacy failures, context isolation failures and duplicate side effects MUST each be zero.

#### Scenario: Complete paired result
- **WHEN** a pair completes with all required measurements
- **THEN** saved raw samples, outcome comparisons and unrounded calculations determine every threshold independently without averaging away a failed pair

#### Scenario: Failed or inconclusive attempt
- **WHEN** a threshold fails or a required metric is unavailable
- **THEN** the original result is retained, adoption remains blocked, and a correction requires a recorded hypothesis rather than an unchanged rerun or retroactive threshold change

### Requirement: Disposition distinguishes source and runtime proof

The report SHALL identify the pilot as supported, refuted or inconclusive and cite its measurements, queries, privacy/fault checks, versions and cleanup evidence. Only satisfaction of every mandatory prerequisite and acceptance gate SHALL support adoption. Queue drops, cap failures, growth in component/event volume or material runtime/host changes SHALL trigger budget review with rationale and fresh measurements. Source delivery MUST NOT imply installation or physical acceptance.

#### Scenario: Backend checks pass but performance fails
- **WHEN** ingestion works but any mandatory measured threshold fails
- **THEN** the report does not mark adoption supported and retains both successful ingestion evidence and failed measurements

#### Scenario: Supported synthetic result
- **WHEN** all required synthetic, performance and delivery gates pass
- **THEN** the report permits dependent source adoption while explicitly excluding live installation and physical qualification
