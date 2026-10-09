# Verification checks

Run commands from the repository root with Node 24 and the dependencies in
[development setup](../../docs/development.md). This file owns the component-specific checks;
[SDLC](../../docs/sdlc.md) owns delivery policy and required evidence.

## Shared observability contract checks

The source contract in `packages/observability` uses Node 24 and Python 3.14. From the assigned worktree, run `npm ci`, install
`requirements-contracts.txt` in an isolated Python environment, then run
`npm run build`, `npm run typecheck`, `npm run test:observability`,
`npm run test:observability:python`, `npm run test:observability:query` and
`npm run test:observability:package` and `npm run test:observability:browser`
(with Chromium in the shared Playwright cache). The browser check runs in the
App verification CI job, where Chromium is already installed. The core CI job
runs the built conformance, Python, query and archive-consumer checks. Keep
the shared controller/lifecycle/workflow and affected consumer checks required
by the final change.

Fixtures cover safe canonical records, exact OTLP mappings, strict version
projections, privacy, context isolation and bounded sink failures. Profile 1.2
fixtures cover the runtime's records and their negative controls, profile 1.3
fixtures its decision, outbox and device records and theirs (#949), profile 1.4
fixtures the gateway's route, method and credentials reload and theirs (#835),
profile 1.5 fixtures the core's costly-save records and theirs (#976), and
`tests/profile.test.mjs` checks that the schema and catalog agree, that every
earlier profile rejects each profile's additions, and the runtime scopes'
rules. `tests/host.test.mjs` checks that a host records only its profile's span
names, which `test_host.py` checks for the Python helper, and records spans
through the host adapter's bounded local span sink with no collector.
The package check verifies immutable archive contents and independent TypeScript/Python
consumers. These checks use synthetic records, no collector, device or live
state. Real ingestion and Grafana queries belong to the separately bounded functional
pilot; passing fixtures do not establish adoption. Performance is unqualified.


## Shared observability pilot checks

The functional pilot in [#704](https://github.com/jimmie-potts/agent-device-hub/issues/704)
checks real ingestion, trace/log correlation and representative failure behavior.
The owner-approved scope revision of 2026-10-02 defers paired performance
qualification. A supported functional result does not claim acceptable overhead,
installed coverage or physical-device behavior.

### Source validation

Use Node 24 and Python 3.14. Run `npm ci`, the shared build/type/contract
and workflow checks, the owning Hub/Hub MCP/package checks, and
`npm run test:observability:pilot`. CI runs the pilot tests in the core
job. The source tests use synthetic inputs and no Docker.

Hub synthetic state must be outside every Git checkout. On this host use:

```bash
TMPDIR=/home/jimmie/projects/.local/scratch/o704 fnm exec --using=.nvmrc -- npm run test:observability:pilot
```

Keep npm and browser downloads in the shared caches. Put durable evidence in
the main checkout's `.local/evidence/`, never only inside a removable worktree.
The pilot consumes the checksum-verified observability 1.0.0 archive from
`vendor/`; Node and Python packaged-consumer checks reject damaged inputs.
Public dependencies use the consumer lock
matching the root lock; run root `npm ci` first to populate their exact tarballs.
Consumer setup needs no cached registry metadata.

### Local synthetic qualification

The existing local Docker engine is required. Do not install or reconfigure it
as part of these commands. The pinned backend is
`grafana/otel-lgtm:0.34.0@sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b`.
The run requires that image already present and verifies its identity and size.

The profile uses a fresh task-owned ordinary bridge and volume, exact loopback
port bindings, two CPUs and 4 GiB RAM with no extra swap. Keep at least 8 GiB
host-available RAM, at most 10 GiB image space and 2 GiB run data. The resource
watchdog stops the owned stack on a cap breach or missing required evidence.
No privileged mode, physical device, host networking, daemon or firewall change
is permitted. An ordinary bridge allows outbound traffic; all producer state is
synthetic and backend analytics/plugin downloads are disabled.

Supply a new evidence directory and an existing disk-backed state parent outside
Git. Choose free ports; the example uses 43000–43004:

```bash
fnm exec --using=.nvmrc -- npm run qualify:observability -- ingestion \
  --evidence-dir /home/jimmie/projects/agent-device-hub/.local/evidence/gh-706-observability/final-ingestion \
  --state-parent /home/jimmie/projects/.local/scratch/o704 \
  --endpoint unix:///var/run/docker.sock \
  --ports 43000,43001,43002,43003,43004
```

`ingestion` performs one authenticated Hub brightness command through the fake
controller, plus a Python contract fixture. Expect seven Node logs/six spans and
one Python log/span. Saved queries compare canonical identities and fields in
Loki/Tempo within a 30-second visibility window; export acknowledgment alone
cannot pass. The Python fixture proves compatible ingestion, not complete Python
application instrumentation. The backend stops and its confirmed run-owned resources/state are removed before the command returns.

Other supported modes use the same arguments:

- `backend-smoke`: readiness and resource checks, with no application workload.
- `delivery-smoke`: three commands with prequeue identities and loss accounting.
- `command-faults`: ten representative command, context and error scenarios.
- `paused-collector` and `absent-collector`: retained bounded fault procedures,
  each using 200 sequential commands per mode. They are available for relevant
  regressions; routinely repeating them is not required for the practical pilot.

The application uses the real Hub route and native ticket semantics. The fake
controller has an independent execution oracle; admission is not execution and
a timeout after admission remains uncertain. No command is automatically retried.
Pino has one Collector log path. Manual and narrowly scoped outgoing HTTP spans
use the shared fields. No incoming pre-authentication instrumentation, device
endpoint tracing, baggage or tracestate is enabled. Host-owned queues remain
bounded to 1,024 records/4 MiB per signal, with 8 KiB records and drop-newest
counters. Flush is bounded to one second; the pilot reserves 50 ms of that for
finalization. Preserve the failed original flush attempt in historical evidence.

### Cleanup and retained evidence

Each run saves exact ownership manifests and lifecycle results. A failed or
partial allocation must be inspected before cleanup; never retry ambiguous
start/stop/removal effects or use Docker prune. After a confirmed stop, the command automatically invokes the receipt-based
`cleanupQualification` helper in `scripts/observability/qualification-cleanup.mjs`
verifies stopped containers and application absence, removes only the recorded
container/network/volume and synthetic state, and retains evidence. Cleanup
refuses foreign resources, running applications and unknown state. Preserve its
receipt and verify that unrelated containers remain untouched. The container
teardown budget is 30 seconds.

### Existing Grafana viewer

Keep the backend inside a monitored `withReadyBackend` action while inspecting
it; standalone qualification stops it on return. Do not restart a stopped run
merely to inspect its UI. Existing applicable screenshots and queries may be
reused with their source revision and limitations recorded.

1. Read the Node `trace_id` from `ingestion-producer.json`. Open the selected
   loopback Grafana port and choose **Explore → Loki**.
2. Select the recorded time range and query
   `{service_namespace="bunny",deployment_environment_name="test"} | trace_id="<trace_id>"`.
   Inspect `event_name`, `severity_text`, `bunny_operation`, `bunny_outcome`,
   `bunny_ticket_epoch`, `bunny_ticket_sequence`, `span_id` and service fields.
3. Open **Explore → Tempo** and look up the same trace ID. The fixture has six
   Node spans across Hub, controller and worker, including queue/execution.
4. Retain the exact queries, time range and screenshots. Manual trace-ID lookup
   is the initial workflow; no automatic log-to-trace link is claimed.

The pinned Collector copies OTLP event names to the queryable `event_name`
attribute for Loki. Loki normalizes attribute dots to underscores; the query
reader preserves typed values. Request/ticket/trace identities remain metadata,
not high-cardinality stream labels. Python uses the same mapping.

### Functional disposition and deferred work

A supported recommendation needs applicable ingestion/viewer, command/failure
and cleanup evidence plus normal independent reviews, tests and CI. Run a short
final-candidate functional check and rerun tests affected by changes. Reuse
existing valid evidence instead of repeating every experiment. Missing or failed
functional evidence remains a blocker; source tests alone do not prove ingestion.

The original paired harness is recoverable from
`archive/gh-704-full-qualification-20261002` at `3e2f363`. Both attempted suites
remain inconclusive; neither produced a qualified measured pair. Original
threshold bytes and raw results remain evidence. They are not relabeled passing
under the new scope. Numerical overhead qualification, exhaustive browser/hook/
helper coverage and production backend operation are deferred. Revisit budgets
if real use exposes drops, resource problems or materially greater volume.

No command here installs a daily-use service, changes personal hooks/settings,
migrates live state or operates a physical device. Practical source adoption and
its enable/disable configuration are separate from an explicitly authorized
installation.


## Shared host diagnostics checks

`npm run test:observability:built` includes the explicit Node host runtime
checks against a loopback fake OTLP endpoint. `npm run test:observability:python`
and `npm run test:observability:package:built` cover the Python host and external
immutable consumer; both run in the core CI job with Python 3.14.
Run build/type first and install the pinned contract and host requirements.
Browser conformance keeps the pure entrypoint separate. Hub CLI/request/worker
adoption is covered by the existing Hub/MCP/setup checks. These are synthetic
source checks; they do not install services or qualify physical devices.

