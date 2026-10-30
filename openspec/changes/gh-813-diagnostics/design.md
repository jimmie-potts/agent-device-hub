## Context

The runtime builds every record itself (`apps/runtime/src/log.ts`) and writes it to stderr; it starts the
observability package's host adapter (`tracing.ts`) for spans only, with a no-op local log sink, 100% head sampling
and the state directory's span file or an in-memory ring, and no Collector. The adapter already has an OTLP/HTTP
transport (`otlp-http.mjs`: one record per request, one in flight, a one-second timeout, no retries) behind bounded
drop-newest queues, but accepts only a numeric loopback Collector origin. The Mac runtime runs in a container on its
own bridge, which the operator (`scripts/bunny.mjs`) refuses to share with any other container. The #704 pilot
qualified Collector and Loki mappings on a throwaway amd64 image with no retention.

Host, measured 2026-10-30: Docker Desktop 29.9.1, Linux ARM64, 12 CPUs and 8 GiB for the engine; the runtime at a
4 GiB limit and about 156 MB resident; 1.6 TiB free on the Mac.

## Goals / Non-Goals

**Goals:**
- Searchable logs, trace timelines and links in both directions for the runtime and its modules, collected while
  B.U.N.N.Y. runs, in a Mac-local Grafana.
- One ingestion path per signal, bounded everywhere, with loss visible and no effect on results.
- A seven-day window and a disk bound that may shorten it, applied to diagnostic data only.

**Non-Goals:**
- Remote access to Grafana, alerts, metrics, custom dashboards beyond starter queries, a custom in-app reader (#812),
  unattended startup, backups, replay, lossless delivery, physical-device tests of every module.

## Decisions

- **Separate pinned images, not the pilot's bundle.** `grafana/loki:3.7.9`, `grafana/tempo:2.10.10`,
  `grafana/grafana:12.4.14` and `otel/opentelemetry-collector-contrib:0.164.0`, each a multi-architecture index
  pinned by digest and pulled for `linux/arm64`. Each gets its own memory limit (256 MiB, 768 MiB, 768 MiB,
  512 MiB; about 2.3 GiB in all) and configuration file in the repository, so retention and admission are explicit
  and reviewable. Rejected: `grafana/otel-lgtm`, whose amd64 digest the pilot pinned, whose 4 GiB budget is most of
  the engine's memory, and whose Loki, Tempo and Grafana settings would be overridden inside one image.
- **The Collector stays.** The runtime's transport sends both signals to one origin (`/v1/logs`, `/v1/traces`), so one
  receiver fans out to Loki and Tempo, keeps the pilot's `event_name` copy (Loki's native OTLP importer still drops
  `LogRecord.EventName`) and absorbs a backend hiccup for 30 seconds before dropping. Rejected: sending to Loki and
  Tempo directly, which would need two origins and a second transport.
- **Reaching the Collector.** The runtime container reaches the Mac's loopback through `host.docker.internal`, which
  Docker Desktop resolves for every container; the Collector publishes `127.0.0.1:4318` on the Mac, so the runtime's
  own `local` bridge, the operator's one-network check and the trust boundary are unchanged. The host adapter's origin
  check admits exactly that name beside the two numeric loopback forms, in Node and Python; a DNS name, a LAN or a
  device address stays refused. Rejected: putting the stack on the runtime's network (the operator refuses it, and
  the docs make that network the trust boundary) or a sidecar sharing the runtime's namespace (a second container in
  the owned profile the operator does not know).
- **Export from the runtime's own writer.** `diagnostics.export.collector` in the configuration file (the section
  #811 added) turns on the adapter's log pipeline with that origin; the log writer's sink becomes "stderr, then the
  adapter", so the same floor and the same records reach both, and the adapter's own severity filter is set to TRACE
  so it never filters a second time. Spans export from the adapter the runtime already starts. The stderr journal is
  never scraped. Rejected: a Collector `filelog` receiver over `docker logs` (two ingestion paths, duplicates).
- **Loss summary.** Profile 1.7 admits `telemetry.dropped` under `bunny.runtime`; the runtime writes one when the
  adapter's export counts first grow, then at most one a minute while they keep growing, with the drops and
  failures since the last summary, and `runtime.stopped` keeps its totals. ADR 0012's repetition rule.
- **Retention and the disk bound.** Loki `retention_period: 168h` with the compactor; Tempo `block_retention: 168h`.
  Neither supports a byte-based cap, so the bound is admission: Loki 1 MiB/s with a 4 MiB burst and 16 KB lines,
  Tempo 2 MiB/s with 5 MiB per trace and 20,000 traces, so even a flood holds at most about 600 GB raw in a week on a
  1.6 TiB disk, and the runtime's actual rate is hundreds of bytes an hour. The actual usage is read with
  `docker system df -v` and recorded at installation. The accepted consequence: under a flood the Collector drops and
  the runtime's queue drops, visibly. Rejected: a size-capped `tmpfs` volume (memory, lost on every engine restart)
  and a janitor that deletes the oldest blocks (machinery the owner does not need).
- **Grafana access.** Anonymous, as organization admin, with sign-up, the login form, basic authentication, analytics
  and plugin fetches off, on `127.0.0.1:3000` only: the same trust the dashboard's loopback sign-in extends. Loki is
  the default source with a `trace_id` derived field to Tempo; Tempo has a traces-to-logs query by trace ID; a
  provisioned, read-only "B.U.N.N.Y. diagnostics" dashboard carries the starter queries by module, severity, event,
  outcome and trace ID.
- **The viewer link.** A Diagnostics card on Connections reads `links.grafana` from the runtime's existing
  `/api/v2/links`, exactly as a Local place does, so a preview never links to an installed viewer. Rejected: a
  `grafana` entry in `docs/skins/places.json`, which every retained documentation page renders and checks, so the
  manifest change would mean regenerating all of them for one dashboard link.
- **Coverage pass.** The bus records every command's admission, reply, queue and execute spans; the tracker every
  step; each module its outbox and device records; LIFX, Pixoo, ONN, Wemo, Tidbyt and Nanoleaf writes have
  `bunny.device.call` spans. Added: a span for the Nanoleaf moment's read of the current effect, inside the command's
  trace. Left as they are, deliberately: device polls (LIFX reads keep theirs; Nanoleaf, playback and Tidbyt status
  polls have degradation/recovery records and no span, since a span per poll at 100% sampling is trace noise),
  Codex Desktop and Wispr local file reads (no external I/O; their failures are records), and Roborock's read-only
  reader (one span). The inventory is recorded in the issue.

## Risks / Trade-offs

- **Loss during an outage.** A Collector that is down for more than a second per record loses that record; the runtime
  never blocks. Accepted by the owner; the summary makes it visible.
- **Trust on loopback.** Any program on the Mac can read Grafana or post to the Collector. The same holds for the
  dashboard's loopback sign-in; nothing is published beyond `127.0.0.1`.
- **Private text in Loki.** Profile 1.7's filtered exception text now sits in a queryable store on the Mac. It is the
  owner's private diagnostic data under ADR 0011, deletable with `down -v`, never published.
