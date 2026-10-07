## ADDED Requirements

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

#### Scenario: Two hosts in one process
- **WHEN** two hosts with `globalContext: false` record spans at the same time
- **THEN** each sink receives only its own host's spans, with their explicit parents, and neither host registers a context manager
