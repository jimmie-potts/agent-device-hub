## 1. The backend

- [x] 1.1 Define `deploy/diagnostics/compose.yaml` with the four pinned multi-architecture images, loopback-only ports, memory limits, read-only roots and dropped capabilities, and the Collector, Loki, Tempo and Grafana configuration files with seven-day retention, admission limits and the pilot's mappings.
- [x] 1.2 Provision the Loki and Tempo sources with the `trace_id` derived field and the traces-to-logs query, and the read-only starter dashboard.
- [x] 1.3 Boot a disposable copy on alternate ports, post one profile 1.7 record and one span, read them back through Grafana's proxies from Loki (labels and metadata) and Tempo, and remove the copy with `down -v`.

## 2. The export

- [x] 2.1 Admit `host.docker.internal` as an owned Collector origin in the Node adapter and the Python helper, with tests for the accepted and refused forms.
- [x] 2.2 Add `diagnostics.export.collector` to the configuration file, start the adapter's log pipeline with that origin at a TRACE floor, feed every record of the runtime's writer to it after stderr, and export spans from the same adapter; refuse a malformed origin with `config-invalid`.
- [x] 2.3 Write `telemetry.dropped` with the export's totals once a minute at most while its drops or failures grow, keep `runtime.stopped`'s totals (written before the final flush, so the export carries it) and count what the final flush loses in one last summary.
- [x] 2.4 Test the export against a loopback fake Collector: every record and span of a request arrives once with its trace, a Collector that refuses, stalls or is absent changes no result and leaves the loss counted and summarized, and a run without the section exports nothing.

## 3. The viewer link and coverage

- [x] 3.1 Add the Diagnostics card to Connections from the runtime's links, with the browser checks for a named viewer and for none.
- [x] 3.2 Record the coverage inventory and add the Nanoleaf moment's read span; name what stays uninstrumented and why.

## 4. Documentation and qualification

- [x] 4.1 Document the stack's setup, start, stop, inspection, retention, loss and reset in the container guide, and the owned origins in the observability README.
- [x] 4.2 Update the diagnostic contract's adoption boundary and ingestion text, the runtime README's configuration, logs and spans sections and the dashboard README.
- [ ] 4.3 Run build, typecheck, lint, the observability Node and Python checks, the runtime, scenario, dashboard (browser) and container checks and OpenSpec validation; synchronize the specifications and archive the change on the delivery branch before final review.
- [ ] 4.4 Install on the Mac under the standing authority: pull and create the stack, add the export origin and viewer link to the private configuration, start both, and record searchable records, a representative trace, both links, a Collector outage and a manual restart in #813 with counts and sanitized evidence only.
