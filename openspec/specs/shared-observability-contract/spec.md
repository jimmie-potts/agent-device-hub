# Shared observability contract Specification

## Purpose

Define one versioned diagnostic form that B.U.N.N.Y. components can validate, query and correlate across languages without exposing private content or changing product behavior.

## Requirements

### Requirement: Canonical language-neutral diagnostic records

The artifact SHALL define required and optional fields, bounds, registered resources/scopes/events/attributes, severity mappings and exact OpenTelemetry mappings for one canonical UTF-8 NDJSON form. Timestamps SHALL preserve millisecond UTC precision without unsafe numeric conversion, and durations SHALL use one local monotonic clock.

#### Scenario: Equivalent language records
- **WHEN** TypeScript and Python process the shared valid fixture corpus
- **THEN** they produce equivalent normalized records and OTLP fields for all six severities, timestamps, operation outcomes and optional correlation
- **AND** a synthetic query finds service, operation, outcome, ticket and trace identity using fields rather than message parsing

#### Scenario: Unknown source time and invalid values
- **WHEN** source time is unavailable or a record has an invalid timestamp, number, ID, version or oversized value
- **THEN** unknown source time remains absent with observed time separate, and invalid records fail validation without invented values or private error output

### Requirement: Allowlisted diagnostics before local output and export

Records SHALL contain only registered static body/event text and bounded approved metadata. Private content and unknown fields SHALL NOT enter local or exported output. Receiver observations SHALL distinguish their own identity from observed source identity.

#### Scenario: Private input and thrown errors
- **WHEN** negative fixtures place secrets, private paths, URLs, payloads, titles or raw exception content in inputs and unknown nested fields
- **THEN** safe construction/conversion emits none of those values and reports only a bounded registered failure reason
- **AND** strict validation rejects canonical records containing forbidden fields

#### Scenario: Receiver evidence has limited provenance
- **WHEN** an owner observes a hook or external boundary
- **THEN** its diagnostic identifies the observation and does not claim an unseen source emission, connectivity, completion or physical success

### Requirement: Qualified correlation and isolated context

Trace context SHALL remain untrusted metadata accepted only at authenticated owned boundaries and SHALL NOT change authorization, admission, retries or product outcomes. Baggage/tracestate and vendor/device propagation SHALL be disabled. Concurrent and deferred work SHALL preserve distinct context with absence represented honestly.

#### Scenario: Concurrent and queued operations
- **WHEN** independent operations interleave and explicitly captured context crosses a queue handoff
- **THEN** records retain only their initiating operation context and previous context is restored after completion or failure

#### Scenario: Malformed or untrusted propagation
- **WHEN** context is absent, malformed, unauthenticated or destined for an external service/device
- **THEN** no qualified parent or outgoing tracing headers are produced and product admission remains the owner's decision

### Requirement: Bounded fail-open instrumentation

Libraries SHALL default to no-op, perform no import-time I/O and propagate no instrumentation failures into product work. Records SHALL be at most 8 KiB, queues at most 1,024 records and 4 MiB per signal, and flush waits at most one second. Saturation SHALL drop newest records with bounded safe loss evidence.

#### Scenario: Slow or failed sink
- **WHEN** an injected sink stalls, throws or rejects, or the queue saturates
- **THEN** retained work and shutdown remain bounded, dropped/failure counts remain safe, and product operations are not retried or failed by telemetry

#### Scenario: Import and default operation
- **WHEN** a consumer imports the artifact or uses its default instrumentation
- **THEN** no exporter, listener, file writer, timer or device operation starts

### Requirement: Explicit compatibility and immutable consumers

The profile SHALL pin schema and semantic-convention versions independently, reject unsupported versions, and provide explicit projections for supported strict consumers. Packaged TypeScript, Python and browser-safe consumers SHALL use immutable artifact bytes without sibling-source imports.

#### Scenario: Mixed supported versions
- **WHEN** a newer supported record is projected for an older strict profile
- **THEN** only that profile's registered fields remain, common query semantics survive, and unsupported or forbidden data is not forwarded

#### Scenario: External package use
- **WHEN** a disposable consumer installs the archive outside the source checkout
- **THEN** manifest hashes, language fixtures, browser-safe imports and query mappings pass against the packaged bytes
- **AND** existing controller/lifecycle consumers remain compatible

### Requirement: Honest adoption and evidence boundaries

The contract documentation SHALL inventory owned producer groups, repository owners and proposed seams with unadopted status, and explicitly classify pure/no-op, silent-hook receiver, retired/static and external-tool boundaries. Existing machine protocols, domain receipts and verification proof SHALL retain their separate meaning.

#### Scenario: Contract delivery is not runtime adoption
- **WHEN** the artifact and fixtures pass source validation
- **THEN** documentation still identifies consumer adoption as pending and claims neither live ingestion, installed coverage nor physical acceptance
