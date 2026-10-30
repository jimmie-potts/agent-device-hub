## MODIFIED Requirements

### Requirement: Allowlisted diagnostics before local output and export

Records SHALL contain only registered static body/event text and bounded approved metadata. Private content and unknown fields SHALL NOT enter local or exported output. Receiver observations SHALL distinguish their own identity from observed source identity. The one admitted exception text SHALL be the filtered, bounded fields that profile 1.7 registers for the runtime's fault records on the private diagnostic path; a raw message, stack or cause SHALL stay out of every record.

#### Scenario: Private input and thrown errors
- **WHEN** negative fixtures place secrets, private paths, URLs, payloads, titles or raw exception content in inputs and unknown nested fields
- **THEN** safe construction/conversion emits none of those values and reports only a bounded registered failure reason
- **AND** strict validation rejects canonical records containing forbidden fields, the raw `error.stack` field included

#### Scenario: Receiver evidence has limited provenance
- **WHEN** an owner observes a hook or external boundary
- **THEN** its diagnostic identifies the observation and does not claim an unseen source emission, connectivity, completion or physical success

### Requirement: Profile 1.5 registers a store's costly saves

Profile 1.5 SHALL be profile 1.4 plus, under `bunny.module`, the events `storage.cost.high` and `storage.cost.normal`, and the attributes `bunny.state.bytes`, the size in bytes of the state a save wrote, a nonnegative safe integer, and `bunny.save.duration_ms`, the time one save took in milliseconds, nonnegative and at most one day. Profiles 1.0 to 1.4 SHALL reject each, and profile 1.5 SHALL add no span name. The Python helper SHALL validate and convert profile 1.5 records.

#### Scenario: A costly save's record
- **WHEN** a `storage.cost.high` record carries a size in bytes, another a save's time, and a `storage.cost.normal` record a time, each under `bunny.module` with its module's name, and the same records claim profile 1.4 or the `bunny.runtime` scope, or carry a fractional size, the state's text as its size, or a time over a day
- **THEN** the three are valid at 1.5, invalid at 1.4 and fail to project to it, and the others are invalid

#### Scenario: Cross-language profile 1.5 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the costly-save records and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus against the installed archive

## ADDED Requirements

### Requirement: Profile 1.6 registers assistant execution

Profile 1.6 SHALL be profile 1.5 plus, under `bunny.module`, the events `assistant.run.started`, `assistant.run.settled` and `assistant.call.settled`; the attributes `bunny.assistant.task_id`, `bunny.assistant.run_id` and `bunny.assistant.effect_id`, each 1 to 128 ASCII letters, digits or hyphens; and the span names `bunny.assistant.run`, `bunny.assistant.model` and `bunny.assistant.tool`. The records SHALL carry identifiers and the existing outcome and error fields only, never conversation text or a raw exception. Profiles 1.0 to 1.5 SHALL reject each addition, and a host at an earlier profile SHALL record no assistant span. The Python helper SHALL validate and convert profile 1.6 records.

#### Scenario: An assistant run's records
- **WHEN** an `assistant.run.started` record carries a task and run identifier under `bunny.module`, the same record claims profile 1.5 or the `bunny.runtime` scope, and another carries a prompt in an unregistered attribute
- **THEN** the first is valid at 1.6, invalid at 1.5 and fails to project to it, and the others are invalid

#### Scenario: Cross-language profile 1.6 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the assistant records and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus against the installed archive

### Requirement: Profile 1.7 registers private exception context

The artifact SHALL be version 1.7.0 with profiles 1.0 to 1.7, and producers SHALL still default to profile 1.1. Profile 1.7 SHALL be profile 1.6 plus the attributes `exception.message`, 1 to 1,024 characters, `exception.stacktrace`, 1 to 4,096 characters, `bunny.exception.redacted_count`, a nonnegative safe integer, and `bunny.exception.truncated`, a boolean, admitted only under `bunny.runtime` and `bunny.module` and only together: a record with either text SHALL carry both counts, and a record with the counts SHALL carry at least one text. Profile 1.7 SHALL also admit the event `telemetry.dropped` under `bunny.runtime`, for the runtime's summary of lost records and spans; a hub host's `telemetry.dropped` under its own scopes SHALL be unchanged. Profiles 1.0 to 1.6 SHALL reject each addition, the raw `error.stack` field SHALL stay refused, and profile 1.7 SHALL add no span name. Projecting a 1.7 record to profile 1.2 to 1.6 SHALL remove the four exception fields and keep the rest, as projecting to 1.0 removes queue depth; a projection to 1.0 or 1.1 of a runtime record SHALL still fail. The Python helper SHALL validate and convert profile 1.7 records and remove the four fields on its projections.

#### Scenario: A fault record's filtered text
- **WHEN** a `runtime.module.failed` record under `bunny.runtime` and an `operation.failed` record under `bunny.module` carry a message, a stack, the count of replaced segments and the truncation flag at profile 1.7; the same records claim profile 1.6; a hub host's record carries the message; a message is empty or over 1,024 characters; a stack is over 4,096 characters; a record carries the counts without a text or a text without the counts; and a record carries the raw `error.stack` field
- **THEN** the first two are valid at 1.7, invalid at 1.6 and project to 1.6 without the four fields with their type, code, trace and span intact, and every other record is invalid

#### Scenario: The runtime's telemetry-loss summary
- **WHEN** a `telemetry.dropped` record with `bunny.telemetry.dropped_count` and `bunny.telemetry.failure_count` is written under `bunny.runtime` at profile 1.7, the same record claims profile 1.6 or the `bunny.module` scope, and a hub host writes one under `bunny.host` at profile 1.1
- **THEN** the first and the hub host's are valid, and the others are invalid

#### Scenario: Cross-language profile 1.7 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the exception records, the loss summary and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output, both remove the four fields on projection, and the packaged consumer passes the same corpus against the installed archive
