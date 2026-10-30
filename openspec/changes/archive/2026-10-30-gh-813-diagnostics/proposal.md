## Why

The runtime records diagnostic logs on stderr and spans in a bounded local sink, and nothing reads them but
`docker logs` and a disposable run's follow query. The owner decided on 2026-10-30
([epic #810](https://github.com/jimmie-potts/agent-device-hub/issues/810)) to collect them continuously on the Mac and
read them in Grafana, with Loki and Tempo, through searchable logs, trace timelines and links in both directions;
[#813](https://github.com/jimmie-potts/agent-device-hub/issues/813) owns the export, the backend, the viewer link, the
coverage pass and the installed acceptance. #777 (profile 1.7) and #811 (log floors) are its accepted source inputs.

## What Changes

- **One owned diagnostics stack** (`deploy/diagnostics/`): an OpenTelemetry Collector, Loki, Tempo and Grafana as the
  Compose project `bunny-diagnostics`, pinned by multi-architecture digests, published only on the Mac's loopback
  (Grafana 3000, OTLP/HTTP 4318), with seven-day retention, admission limits, memory limits and provisioned Loki and
  Tempo sources with links in both directions and a starter dashboard. Operated by hand beside the runtime; its data
  is deletable diagnostic data.
- **Export from the runtime.** The configuration file's `diagnostics.export.collector` names the Collector origin;
  the runtime's log writer feeds the host adapter's OTLP log pipeline beside the stderr journal, and spans export from
  the same adapter, so each signal has one ingestion path. The adapter admits `host.docker.internal` as an owned
  origin beside numeric loopback, which is how the runtime container reaches the Mac's loopback without joining
  another network. Loss stays visible: the bounded queues count drops and failures, the runtime writes a
  `telemetry.dropped` summary at most once a minute while loss goes on, and `runtime.stopped` keeps its counts.
- **A viewer link** on the dashboard's Connections page, shown only when the runtime's links name `grafana`, as a
  Local place is shown.
- **Coverage.** The inventory of the shared runtime and each shipped module's records and spans is recorded in the
  issue; the pass fills the gaps worth filling (a device-read span inside a Nanoleaf moment) and names what stays
  uninstrumented and why (polls without spans, local file reads).

## Capabilities

### Modified Capabilities

- `shared-observability-host`: owned Collector origins include Docker Desktop's host alias.
- `shared-observability-contract`: the adoption boundary records the runtime's export.
- `bunny-runtime`: the `diagnostics.export` section, the export path and the loss summary.
- `runtime-dashboard`: the Diagnostics card on Connections.
- `bunny-container-operator`: the Mac-local diagnostics stack and its operating procedure.

## Impact

- **Code:** `deploy/diagnostics/*`; `packages/observability/runtime/propagation.mjs` and the Python host's origin
  check; `apps/runtime/src/{state.ts,runtime.ts,tracing.ts,log.ts}`; `apps/runtime/dashboard/src/main.tsx`;
  `modules/nanoleaf/src/module/runtime.ts`.
- **Unchanged:** the runtime's network and the operator's checks, every message format and API, the stderr journal,
  module behavior and results; the dashboard builds no log table, trace view or query API (#812 deferred).
- **Delivery:** source, then the Mac installation under the standing installation authority: the private
  `runtime.json` gains the export origin and the viewer link, the stack starts beside the runtime, and the installed
  evidence (searchable records, a representative trace, both links, collector outage and restart) is recorded in #813.
