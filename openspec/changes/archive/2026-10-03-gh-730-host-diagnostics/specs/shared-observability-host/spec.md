## Purpose

Provide explicit host-owned diagnostics with the same canonical log and trace fields across Node and Python applications, without making telemetry a dependency of domain operations.

## ADDED Requirements

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
