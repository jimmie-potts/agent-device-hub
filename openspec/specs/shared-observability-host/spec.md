# Shared observability host

## Purpose

Provide explicit host-owned diagnostics with the same canonical log and trace fields across Node and Python applications, without making telemetry a dependency of domain operations.

## Requirements

### Requirement: Explicit compatible host construction
The artifact SHALL offer explicitly constructed Node and Python host diagnostics while preserving the existing pure/browser contract and schema profiles. Module import SHALL NOT start exporters or background work. Enabled tracing SHALL default to 10% head sampling; export SHALL require an explicit loopback Collector endpoint. This supports #730's package and enablement criteria.

#### Scenario: Disabled and pure consumers
- **WHEN** a host leaves diagnostics disabled or imports only pure helpers
- **THEN** no SDK/exporter, queue thread or network operation starts and existing output is unchanged

#### Scenario: Packaged enabled consumer
- **WHEN** an isolated Node or Python consumer enables diagnostics using the checksum-verified archive
- **THEN** canonical local records and configured OTLP output have the shared resource, scope, operation, outcome and available trace identity

### Requirement: Bounded independent diagnostics
Enabled hosts SHALL preserve 8 KiB record, 1,024-record/4 MiB per-signal queue, drop-newest accounting and one-second concurrent flush limits. Diagnostic failure SHALL NOT change a domain result, retry a command or expose unregistered content. Valid authenticated context SHALL be explicitly adopted only at owned boundaries, and missing context SHALL NOT be fabricated.

#### Scenario: Collection fails
- **WHEN** the local sink or Collector stalls or rejects records
- **THEN** commands retain their outcomes, queues remain bounded, drops/failures are observable and shutdown completes within the flush bound

#### Scenario: Independent concurrent operations
- **WHEN** two authenticated operations cross owned asynchronous boundaries
- **THEN** each log correlates only with its available operation span and no context leaks between them

### Requirement: Local span sink and explicit parents

`createHostDiagnostics` SHALL take an optional `localSpanSink(line, signal)` that receives each recorded span as the `projectSpan` OTLP document, through the span pipeline's bounded queue: at most 1,024 records and 4 MiB, the newest dropped when full, every drop and failure counted. Tracing SHALL require an explicit Collector, a local span sink or both; with both, the local sink SHALL run first, and its failure SHALL be counted without stopping the export. With `globalContext: false`, enabled tracing SHALL install no process context manager: spans SHALL take their parents explicitly, several hosts MAY record spans in one process, and `run` SHALL parent an operation only through its explicit `traceparent`. `schemaVersion` MAY name the profile of the host's records and of its spans' metadata, which SHALL be checked as a record of an event its scope allows; it SHALL default to the contract's producer default. These options SHALL be additive: a host that passes none behaves as before.

#### Scenario: Tracing with no Collector
- **WHEN** a host enables tracing with a local span sink and no Collector, and records a parent and a child span
- **THEN** the sink receives both as projected OTLP spans with durations, status and the child's parent, and no network request is made

#### Scenario: Tracing with neither
- **WHEN** a host enables tracing with no Collector and no local span sink
- **THEN** construction fails, as it did before

#### Scenario: A stalled or failing local span sink
- **WHEN** the local span sink never settles or throws while spans keep ending
- **THEN** at most the queue's bound waits, the drops and failures are counted, and shutdown ends within the flush bound

#### Scenario: The runtime's profile
- **WHEN** a host with the runtime's resource names profile 1.3 and records a module span and a runtime span, and another names no profile
- **THEN** both spans are recorded with profile 1.3 metadata, a module span without its module's name is not, and the host without a profile refuses the runtime's resource

#### Scenario: Span names by profile
- **WHEN** hosts at profiles 1.3, 1.2 and 1.1 each start a `bunny.command.request`, a `bunny.device.call` and a `bunny.outcome.publish` span, and the Python helper at its default profile records the same names
- **THEN** only the 1.3 host records all three; the others record `bunny.command.request` or `bunny.helper.run` only and count each refused span as invalid, and the projection refuses a span whose name its metadata's profile does not register

#### Scenario: Two hosts in one process
- **WHEN** two hosts with `globalContext: false` record spans at the same time
- **THEN** each sink receives only its own host's spans, with their explicit parents, and neither host registers a context manager
