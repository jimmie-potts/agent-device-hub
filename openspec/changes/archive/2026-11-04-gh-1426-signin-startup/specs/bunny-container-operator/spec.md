## MODIFIED Requirements

### Requirement: Mac-local diagnostics stack
The repository SHALL define one owned Compose project, `bunny-diagnostics` (`deploy/diagnostics/compose.yaml`), with an OpenTelemetry Collector, Loki, Tempo and Grafana pinned by multi-architecture image digests, that runs beside the runtime from a fixed installed copy outside every release and checkout (Hub #813, #1426). One install command SHALL copy `deploy/diagnostics` at one named revision to that folder with a record of the revision, keep the previous copy, leave the stack unchanged when the copy does not validate, and recreate the containers from the copy without touching the data volumes. It SHALL publish only Grafana on `127.0.0.1:3000` and the Collector's OTLP/HTTP receiver on `127.0.0.1:4318`, on its own bridge network that the runtime never joins; the runtime SHALL reach the Collector through `host.docker.internal`. Logs SHALL reach Loki and spans Tempo on one OTLP path each, with the Collector copying the event name to the queryable `event_name` attribute, Loki's stream labels limited to the contract's namespace, service and environment and everything else structured metadata. Grafana SHALL be provisioned with the Loki and Tempo sources, a `trace_id` derived field that opens the trace and a traces-to-logs query that finds the trace's records, and the starter dashboard; it SHALL be reached without a password on the Mac's loopback, as the trusted-loopback dashboard sign-in is, as an anonymous Editor that can use Explore and save dashboards but cannot add a data source, with sign-up, the login form, analytics and plugin fetches off. Loki and Tempo SHALL retain seven days with their compactors and SHALL bound admission (Loki 1 MiB/s with a 4 MiB burst and 16 KB lines; Tempo 2 MiB/s with 5 MiB per trace); the Collector SHALL retry a refusing backend for at most 30 seconds and then drop; every container SHALL have a memory limit, the restart policy `unless-stopped`, a read-only root, dropped capabilities and no new privileges. The three data volumes SHALL hold diagnostic data only, which `down -v` may delete; nothing SHALL back up, restore, spool or replay it, and no Collector or runtime failure SHALL change an application result.

#### Scenario: A synthetic record and span reach the viewer
- **WHEN** a disposable copy of the project starts on alternate loopback ports and one profile 1.7 record and one span with the same trace ID are posted to the Collector
- **THEN** Grafana's health is `ok`, both datasources and the starter dashboard are provisioned, Loki answers the trace-ID query with the record's labels and structured metadata, and Tempo returns the span, and `down -v` leaves no container, network or volume of that project

#### Scenario: The operating procedure
- **WHEN** the operator follows the container guide's "Diagnostics stack" section
- **THEN** one revision is installed, the project is started, inspected and stopped with the documented commands, actual volume usage is read with Docker's accounting, and loss is read from the Collector's log and the runtime's `telemetry.dropped` and `runtime.stopped` records

#### Scenario: The stack returns after sign-in
- **WHEN** Docker Desktop starts at sign-in and the project was running when the engine stopped
- **THEN** the four containers return with their configuration from the fixed copy, and a project stopped deliberately stays stopped

## ADDED Requirements


### Requirement: Mac start at sign-in

The Mac host SHALL offer launchd agents, installed by one command and holding no credential or release path, that return the selected core and the private route after sign-in with no pre-login startup. The core agent SHALL run once per sign-in, wait a bounded time for the engine, select the core by its Compose labels, and take the operator from the release named by the core's image revision and the Compose file from its label. It SHALL start the core only through that operator's guarded `start`, so the operation lease, the unfinished-deployment hold and the access checks apply, and it SHALL leave a running core alone. The core SHALL keep no Docker restart policy. It SHALL leave a stopped core stopped when an owner's persistent start hold exists for the project or when the core is the replacement from a failed deployment that was reconciled. A refusal, a missing or ambiguous core, a missing or unusable operator or failed health SHALL be logged and shown as a notification and SHALL NOT be retried or fall back to a direct container start, and the starter itself SHALL NOT stop the core. The private route's two agents SHALL restart their process if it exits.

#### Scenario: Sign-in with a stopped core
- **WHEN** the owner signs in, the engine becomes ready and the selected core is stopped with no unfinished deployment
- **THEN** the core starts through its release's operator and the starter reads its health

#### Scenario: Unfinished deployment at sign-in
- **WHEN** the operator refuses `start` because an operation is unfinished or holds the lease
- **THEN** the core stays stopped, the refusal is logged and notified, and nothing retries it

#### Scenario: A held or failed core at sign-in
- **WHEN** the owner has set the start hold, or the stopped core is a failed deployment's reconciled replacement
- **THEN** the starter does not call the operator, the core stays stopped and a notification says why; a later deployment that replaces the container ends the failed-deployment refusal

#### Scenario: Crash during a session
- **WHEN** the core or the engine stops after the agent has run
- **THEN** the core stays stopped until the next sign-in or a manual start
