## ADDED Requirements

### Requirement: Hourly history change warning

The core SHALL count committed history rows of kind `change` for each writer, family and designated neutral entity ID in each UTC hour of core intake time. Initial, gap and span-closing change rows SHALL count. Separate removals, occurrences, outcomes and operation rows, uncommitted rows and observations that insert no change row SHALL contribute zero. The core SHALL record one diagnostic at row 121 through the SDK, naming the writer, family, neutral entity ID, hour start, count and threshold. Diagnostic failure SHALL leave commit and publication behavior intact.

The counter SHALL hold the latest observed hour and its predecessor in memory. A backward step earlier than both buckets SHALL reset the window to the corrected hour. A discarded hour may warn again after 121 newly counted rows if revisited. Restart SHALL start fresh counts. The alarm SHALL preserve every history row and the fact log's order, with no storage change, scan or timer.

#### Scenario: A committed entity exceeds its threshold
- **WHEN** one entity commits its 121st change row in one UTC hour, including any gap or span-closing change rows
- **THEN** the core attempts one WARN diagnostic naming the entity and its count, and later rows in that retained hour produce no second warning for it
- **AND** a different writer, family or entity has an independent count, and so does the next UTC hour

#### Scenario: An attempted write rolls back or diagnostics fail
- **WHEN** a change row is rolled back or the diagnostic sink fails
- **THEN** the rollback contributes zero and the diagnostic failure leaves the committed rows and publication behavior intact

#### Scenario: The clock moves backward or the core restarts
- **WHEN** the clock revisits a retained hour, lands earlier than both buckets, or the core restarts
- **THEN** a retained hour keeps its counts and warning suppression, an older hour starts a fresh window, and a restart starts empty

## MODIFIED Requirements

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.9, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.9`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

A fault record, `runtime.module.failed`, `runtime.module.refused` with an error, `runtime.handler.failed`, `runtime.module.stop-failed`, `runtime.module.error-after-stop` and `runtime.failed`, SHALL carry the exception's type and code and, through the SDK's `exceptionFields`, its filtered and bounded message and stack with `bunny.exception.redacted_count` and `bunny.exception.truncated`, after each secret the runtime's modules have read is replaced; a record whose exception text still holds such a secret SHALL carry neither text nor the two counts and keep its type and code. A decision or refusal record, `runtime.edge.failed` and `runtime.tracing.failed` SHALL carry the type and code only. An error body, health, history and proof SHALL carry no exception text.

#### Scenario: Every record passes the contract's validator
- **WHEN** the runtime and its fixture modules run in the runtime's tests, in the in-memory harness on both transports, as processes and in a disposable verification run
- **THEN** every record they write passes the contract's validator as its JSON line, every stderr line of a shipped process does too, and each process's records share one instance ID that another process, a restarted one included, does not

#### Scenario: The environment
- **WHEN** the shipped entry point runs without `--environment`, with `--environment production`, or with `--environment staging`
- **THEN** its records carry `development`, then `production`, and the third exits with status 2 and a usage line; a disposable verification run's records carry `test`

#### Scenario: A module's record the contract refuses
- **WHEN** a module logs an unregistered event, one of the runtime's own events, a field the catalog does not register holding a raw message, or a URL in a registered attribute
- **THEN** no record holds the event or the message, the unregistered field is left out of the record that is written, the record with the URL is not written, and the writer counts each record it dropped

#### Scenario: A fault record's filtered text
- **WHEN** a module's responder throws an error whose message quotes a URL with a token parameter and whose code is an identifier, and another module's handler throws an error whose code and message hold a secret the module read from its secrets file
- **THEN** the first module's `runtime.module.failed` record carries its type, code, phase, a message with the token replaced by `[redacted]`, a stack, the count of replacements and the truncation flag, the second's carries its type, phase and a message with the secret replaced and no code, and no record, result or health report holds either secret

#### Scenario: A failing sink
- **WHEN** the sink throws on every record, or the process's stderr is closed
- **THEN** the modules start, answer requests and stop, health answers `ok`, and SIGTERM exits 0
