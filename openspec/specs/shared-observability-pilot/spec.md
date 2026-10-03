# Shared observability pilot

## Purpose

Qualify shared diagnostics through an isolated synthetic Hub command path, retaining enough evidence to judge ingestion, representative failure behavior and useful correlation before practical adoption; numerical performance qualification is deferred.

## Requirements

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

### Requirement: Functional acceptance supports a personal trial

The pilot SHALL demonstrate successful correlated diagnostics for the real authenticated Hub route using a fake controller, and unchanged domain behavior with unavailable telemetry. Applicable existing cross-language, viewer and fault evidence MAY be reused with its exact source revisions and limitations recorded. A short final-candidate functional check and affected regression tests SHALL verify the delivered implementation. Three-pair performance benchmarks and numerical overhead thresholds are explicitly deferred by the owner-approved 2026-10-02 scope revision; they are not passing requirements.

#### Scenario: Useful functional evidence
- **WHEN** the delivered candidate and applicable retained evidence demonstrate ingestion, correlation and bounded failure without changing commands
- **THEN** the functional recommendation may support practical adoption after source-delivery gates pass, while overhead remains unqualified

#### Scenario: Historical failed benchmark
- **WHEN** the report cites an earlier failed or inconclusive benchmark attempt
- **THEN** it preserves that disposition and original inputs without relabeling the attempt successful under the revised scope

### Requirement: Disposition distinguishes source and runtime proof

The report SHALL identify the functional pilot as supported, refuted or inconclusive and cite actual queries, representative checks, versions and cleanup evidence. Required reviews, tests and CI remain adoption gates. The report SHALL explicitly separate unqualified performance and deferred exhaustive coverage from the supported functional scope. Source delivery MUST NOT imply installation or physical acceptance.

#### Scenario: Functional evidence is missing
- **WHEN** ingestion, correlation or required bounded-failure evidence is missing or fails
- **THEN** adoption remains blocked even though performance certification is deferred

#### Scenario: Supported functional result
- **WHEN** required functional evidence and source-delivery gates pass
- **THEN** practical dependent source adoption may proceed, with numerical overhead, live installation and physical qualification explicitly unqualified
