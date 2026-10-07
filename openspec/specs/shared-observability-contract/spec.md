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

### Requirement: Profile 1.2 registers the B.U.N.N.Y. runtime

The artifact SHALL be version 1.2.0 with profiles 1.0, 1.1 and 1.2, and producers SHALL still default to profile 1.1. Profile 1.2 SHALL be profile 1.1 plus the runtime's vocabulary: the `runtime` service; the `bunny.runtime` scope for the runtime's own records and one `bunny.module` scope for every module's records; the runtime's events; the module events `message.received`, `outbox.republished` and `outbox.acknowledged`; and the attributes they use, among them `bunny.module`, `bunny.participant`, `bunny.pattern`, `bunny.code`, `bunny.phase`, `bunny.route`, `server.port`, `error.type` and `error.code`. A record SHALL carry a listener's port, never its URL, and an edge refusal SHALL carry its registry code's fixed reason in the existing `bunny.reason`, never free text. `error.type` and `error.code` SHALL be identifiers of at most 64 characters. Profiles 1.0 and 1.1 SHALL reject every profile 1.2 addition. The catalog SHALL list each profile's additions and, for each runtime scope, the services and events it allows. Both runtime scopes SHALL belong to the `runtime` service; a `bunny.module` record SHALL name its module in `bunny.module` and use only the events listed for that scope; the runtime's own events SHALL appear only under `bunny.runtime`. A new runtime or module event or attribute SHALL be a catalog change with fixtures, contract review and the packaged-consumer checks. A built record SHALL keep only the attributes its own profile registers, in TypeScript and Python. The Python helper SHALL validate and convert profile 1.2 records without a change to validation.

#### Scenario: Additions closed to earlier profiles
- **WHEN** a record uses a profile 1.2 service, scope, event or attribute and claims profile 1.0 or 1.1
- **THEN** it is invalid, and projecting such a 1.2 record to 1.1 fails, while a 1.2 record without them projects to 1.1 and a 1.1 record projects to 1.2

#### Scenario: Runtime scope rules
- **WHEN** a record puts a runtime event under `bunny.module` or another scope, a module event under `bunny.runtime`, a `bunny.module` record without its module's name, or either runtime scope under another service
- **THEN** it is invalid

#### Scenario: Cross-language profile 1.2 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the runtime's records and their negative controls: an unregistered event, a raw message, a stack, a URL with a token, a module name with spaces, a URL, a route that is a path, a free-text reason, the edge's detail, a missing resource field, a module record under the wrong scope or without its name, and a 1.2 record labeled 1.0 or 1.1
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus and tests against the installed archive

#### Scenario: Schema and catalog agree
- **WHEN** the schema's enums and attribute definitions are compared with the catalog
- **THEN** they list the same versions, services, scopes, events, bodies and attributes, and each body is distinct

#### Scenario: Construction leaves out what the catalog does not register
- **WHEN** a profile 1.2 record is built from input with an unregistered attribute holding a raw message, or with a URL in a registered attribute
- **THEN** the built record keeps profile 1.2 and holds no part of the message, and the record with the URL is refused

#### Scenario: Construction keeps only the record's own profile
- **WHEN** records are built at profile 1.0, at the default profile 1.1 and at profile 1.2, in TypeScript and Python, from input with `bunny.queue.depth` and the profile 1.2 attribute `error.type`
- **THEN** the 1.0 record holds neither, the 1.1 record holds only `bunny.queue.depth`, the 1.2 record holds both, and each record is valid at its own profile
