## MODIFIED Requirements

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.5, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.5`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

#### Scenario: Every record passes the contract's validator
- **WHEN** the runtime and its fixture modules run in the runtime's tests, in the in-memory harness on both transports, as processes and in a disposable verification run
- **THEN** every record they write passes the contract's validator as its JSON line, every stderr line of a shipped process does too, and each process's records share one instance ID that another process, a restarted one included, does not

#### Scenario: The environment
- **WHEN** the shipped entry point runs without `--environment`, with `--environment production`, or with `--environment staging`
- **THEN** its records carry `development`, then `production`, and the third exits with status 2 and a usage line; a disposable verification run's records carry `test`

#### Scenario: A module's record the contract refuses
- **WHEN** a module logs an unregistered event, one of the runtime's own events, a field the catalog does not register holding a raw message, or a URL in a registered attribute
- **THEN** no record holds the event or the message, the unregistered field is left out of the record that is written, the record with the URL is not written, and the writer counts each record it dropped

#### Scenario: A failing sink
- **WHEN** the sink throws on every record, or the process's stderr is closed
- **THEN** the modules start, answer requests and stop, health answers `ok`, and SIGTERM exits 0

#### Scenario: Maintenance intake reads the runtime's journal
- **WHEN** the stderr lines of a clean run and of a start refused for a relative state directory become synthetic journald rows that intake reads for service `runtime`
- **THEN** intake accepts every line and turns the `runtime.failed` record into a finding, refuses a record in the #880 format or labeled profile 1.1, and accepts none while its configuration names only `hub`

## ADDED Requirements

### Requirement: Core save cost

The core store SHALL measure each save that commits: agent-state's commit through the store's lease, from before it applies the change to the last committed state, which clones, validates and serializes the whole state, until the outbox's transaction has committed, before any of its messages is published. A save's size SHALL be the byte length of the state block it stores, and its time SHALL be read from a monotonic clock. The store SHALL log `storage.cost.high` at WARN as the state block passes half of the 16 MiB limit, carrying the block's size in `bunny.state.bytes`, and as one save takes longer than 100 ms, carrying its time in whole milliseconds rounded up in `bunny.save.duration_ms`; each condition SHALL be recorded once per run, and the first save back within its limit SHALL log `storage.cost.normal` at INFO with that save's size or time. Both records SHALL carry `bunny.operation` `storage` and no other field, never the state's content. A save that does not commit SHALL change neither condition, the runs SHALL be kept in memory only, and a logger that throws SHALL lose only its record: the save SHALL stand and agent-state's owner SHALL NOT be faulted. The 16 MiB limit and its `state-capacity` refusal SHALL be unchanged, and the intake's grouped transactions and freshness refreshes, which do not write the state block, SHALL NOT be measured.

#### Scenario: A state block past its limit
- **WHEN** a second session's start takes the state block past a lowered limit, a further change keeps it there, a day later agent-state's maintenance lets go of what it keeps for a day, and two more saves stay within the limit
- **THEN** the store logs one `storage.cost.high` WARN with the size of the block that passed the limit and one `storage.cost.normal` INFO with the size of the first block back within it, and each is written whole as a profile 1.5 module record of the core

#### Scenario: A slow save
- **WHEN** saves take 5 ms, exactly 100 ms, 100.25 ms, 250 ms, 5 ms and 5 ms of work in their transactions, and each message's publication after its commit takes a second
- **THEN** the store logs one `storage.cost.high` WARN with 101 ms and one `storage.cost.normal` INFO with 5 ms, publication counts toward no save, and every save commits

#### Scenario: A save that does not commit
- **WHEN** a slow save commits, a quick one is rolled back by a part that throws, and after the owner opens again a quick save commits
- **THEN** the store logs the WARN, nothing for the refused save, and the INFO only for the save that committed

#### Scenario: A logger that throws
- **WHEN** a slow save and then a quick one commit while the logger throws on every record
- **THEN** both observations are `applied` at revisions 1 and 2, and the state row holds revision 2
