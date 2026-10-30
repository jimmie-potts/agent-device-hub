## MODIFIED Requirements

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.7, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.7`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

A fault record, `runtime.module.failed`, `runtime.module.refused` with an error, `runtime.handler.failed`, `runtime.module.stop-failed`, `runtime.module.error-after-stop` and `runtime.failed`, SHALL carry the exception's type and code and, through the SDK's `exceptionFields`, its filtered and bounded message and stack with `bunny.exception.redacted_count` and `bunny.exception.truncated`, after each secret the runtime's modules have read is replaced; a record whose attribute still holds such a secret SHALL be dropped whole and counted. A decision or refusal record, `runtime.edge.failed` and `runtime.tracing.failed` SHALL carry the type and code only. An error body, health, history and proof SHALL carry no exception text.

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

#### Scenario: Maintenance intake reads the runtime's journal
- **WHEN** the stderr lines of a clean run and of a start refused for a relative state directory become synthetic journald rows that intake reads for service `runtime`
- **THEN** intake accepts every line and turns the `runtime.failed` record into a finding whose dimensions are catalog enums only, refuses a record in the #880 format or labeled profile 1.1, and accepts none while its configuration names only `hub`
