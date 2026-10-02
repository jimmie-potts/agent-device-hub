## Context

See proposal.md for motivation. The Hub authenticates requests before its controller-command route. Its controller client validates native envelopes, holds one request slot and times out without retrying. The existing fake controller uses reference ticket admission and replay, but a queued receipt does not prove execution. Observability 1.0.0 is released at Hub revision `673a297ad1225cd18b611de8969dea10b28d33f2`.

The owner accepted the initial numerical budgets and a later review policy in [the decision record](https://github.com/jimmie-potts/agent-device-hub/issues/706#issuecomment-5945109256). Docker is currently unavailable. Source preparation can proceed, but backend qualification and benchmark results remain unexecuted.

## Goals / Non-Goals

**Goals:** Measure the real authenticated Hub command path, preserve its outcomes under telemetry failure, and make a supported/refuted/inconclusive result reproducible from retained evidence.

**Non-Goals:** Change controller admission, retries, wire envelopes, visible UI, domain-journal retention, or live configuration. A passed contract test does not establish successful backend ingestion.

## Decisions

### Host-owned opt-in instrumentation

Add an optional in-process diagnostics dependency to the Hub and controller client. With no dependency, existing behavior is unchanged. The pilot host owns Pino, OpenTelemetry initialization, exporters and shutdown. The released contract owns normalization and field mappings. Package the released archive with its checksum and source receipt using the existing vendor convention; test the packaged Hub consumer outside the workspace.

Context enters the command path only after authentication. Accept only validated traceparent from an authenticated owned peer. Reject propagation of baggage and tracestate. Derive static event names and registered span names from operations; never derive them from request URLs, bodies or exceptions. The outgoing instrumentation allowlist is the exact synthetic controller origin. Incoming automatic HTTP instrumentation is disabled so it cannot create pre-authentication diagnostic content.

Telemetry start/end failures are contained separately from domain execution. Never retry the command callback after an instrumentation error. Explicit tests count invocation and side effects. This avoids an unsafe generic catch-and-repeat wrapper. An autonomous library SDK/exporter was rejected because it would violate host ownership and default enablement.

### Explicit synthetic execution oracle

Keep reference ticket admission and replay in the existing fake controller. Add a bounded synthetic queue, explicit execution records and a side-effect counter independent of telemetry. A queued response remains queued; execution and terminal observations require separate evidence. Exercise success, rejection, duplicate tickets, concurrent requests, queue admission and a timeout after admission. The latter remains uncertain to the caller even when the independent oracle later observes execution.

The opt-in fake executor supports synthetic brightness writes, with at most 32 queued jobs and 256 retained oracle records/settled receipts. The driver must drain oracle records into bounded run evidence. Overflow is reported and prevents a complete per-ticket result; it is not erased when records are drained. Restart and close cancel pending synthetic work. Legacy fixture behavior remains available without execution enabled.

The fake controller's optional diagnostic observer receives only machine metadata and traceparent after authentication. It never wraps a domain callback. Observer exceptions and rejected promises increment a bounded counter; they cannot repeat admission or effects. Queue settlement releases the diagnostic handle. The disabled path does not build diagnostic metadata.

Capture context explicitly when admission queues work. The queue span uses that captured parent; execution uses the queue parent and a causal link to the original admission span, even after the request has ended. Controller and worker records use separate resource identities. Cancellation ends the queue without creating an execution success. Projection must retain only these validated causal link identities, never arbitrary SDK link attributes.

A fixture that merely relabels admission as execution was rejected because it cannot prove duplicate-side-effect safety.

### One log path and restricted span projection

Emit canonical Pino JSON to a bounded host-owned stream. Convert that validated stream through the released OTLP mapping into the Collector log receiver. Do not also attach a Pino OpenTelemetry log bridge. Send spans through the Collector trace receiver after projecting automatic instrumentation attributes onto the contract allowlist. Raw SDK attributes must not reach local evidence or exports.

Use the qualified Node 24 ESM preload with the OpenTelemetry instrumentation hook registered before application imports. Pin API 1.9.1, SDK Node and HTTP instrumentation 0.222.0, Undici instrumentation 0.32.0, instrumentation hook 0.222.0, and resources/trace SDK 2.11.0; lock all transitive inputs. Disable automatic resource detection and environment-supplied external endpoints or headers. The initial readiness prototype pinned trace SDK 2.5.0; dependency audit exposed its older core under [GHSA-8988-4f7v-96qf](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf). Align it to the Node SDK’s own 2.11.0 dependency and repeat the startup check. Preserve the original prototype evidence. The readiness smoke test established module loading and parentage only; the pilot still must prove canonical integration and actual ingestion.

The host bootstrap runs once in a fresh process after the instrumentation hook and before application imports. It rejects inherited `OTEL_*` variables rather than mutating personal settings or letting environment-selected exporters, metric readers, diagnostic console logging or disable flags change the experiment. It explicitly supplies the sampler, resource, processors and propagator, with no SDK log processors or metric readers. The launcher must prepare its own child environment; no system environment is changed.

The single log path is the released bounded Pino emitter, canonical JSON parsing and the released OTLP mapping, followed by one injected transport sink. An optional local evidence sink sees only that canonical JSON; local write failure is counted without duplicating transport. Both signal queues flush concurrently at shutdown. Source fixtures exercise the actual Hub through fake queue execution with seven logs and six correlated spans, and repeat the command with both transports stalled; this remains source/synthetic-sink evidence, not Collector ingestion or a measured pilot.

Each signal is bounded to 1,024 records and 4 MiB, whichever fills first; records are at most 8 KiB. Drop newest and expose bounded safe counters. Export failures cannot enqueue device commands or alter their retry policy. Flush has a one-second bound.

### Disposable pinned backend

Use `grafana/otel-lgtm:0.34.0` at Linux amd64 digest `sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b`. Record its parent manifest digest and component versions. Publish only explicitly selected loopback ports. Do not use privileged mode, host networking, host PID access or device access. Account for all bundled stack services.

Restrict Loki index labels to stable service namespace/name/environment. Preserve request, ticket, trace and span identifiers as queryable metadata rather than indexed labels. Document Loki dot-to-underscore and numeric conversion mappings. Verify the existing Grafana Explore log/trace links without adding a dashboard or changing product UI. Python fixtures must reach the same field queries as Node records.

Disable Docker's log driver for the development backend. Its daemon-owned log files are outside both container writable-layer and data-volume accounting. Application canonical log capture and Collector ingestion remain enabled as specified. This removes the extra backend console copy from disk accounting; backend diagnostics must use service health, query responses and any owned files. Account run data using the larger of allocated/apparent volume bytes, writable-layer size and owned host run files. Qualify the fixed read-only storage probe in the pinned image before workloads; missing utilities or measurements leave the run unqualified. This changes no accepted threshold and precedes every measured run.

Keep at least 8 GiB host-available RAM. Hard-limit the stack to two CPUs and 4 GiB RAM; permit at most 10 GiB image storage and 2 GiB run data. Stop on a cap breach and retain evidence. Keep durable evidence under the main checkout's `.local/evidence/`. The Hub refuses state inside any Git checkout, so put its disposable state in the parent workspace's `.local/scratch/o704` (or a run-owned sibling), outside every checkout. Other task-owned files use disk-backed `.local/`; all credentials are synthetic. Run heavy builds and measurements serially. An unbounded default upstream launcher was rejected because its network and resource settings do not meet this experiment's constraints.

### Frozen paired measurement protocol

Before any measured run, save a machine-readable protocol, thresholds, exact source/image/package revisions and command line with a checksum. Run three disabled/enabled pairs for each of healthy and unavailable collection, in AB, BA, AB order. Each member gets fresh processes and synthetic state, 30 seconds warm-up and 60 seconds measurement at 20 operations/second with at most eight in flight. Use monotonic scheduled slots; retain late dispatches and omitted slots, without catch-up bursts or retries.

Compute nearest-rank p50/p95 from actual dispatch to response, using unrounded values for decisions. Also report scheduled-slot latency and dispatch lag. Throughput counts completions within the measurement interval; report late completions separately. Retain original outcomes and compare a documented projection removing only run-local identifiers and timestamps.

Measure application CPU and peak RSS across the Hub, fake controller and telemetry workers, excluding the driver and query sampler. Record user/system CPU delta divided by elapsed wall time and RSS samples at 100 ms. Measure stack cgroup CPU and the peak summed RSS of all container processes, recording the process inventory and sampling source; do not substitute an undocumented Docker memory display. Missing or unreliable required metrics make the result inconclusive.

Every pair must meet p50 added latency ≤max(2 ms, 10% baseline), p95 ≤max(5 ms, 15%), throughput ≥95% baseline, application CPU increase ≤0.25 core and peak RSS increase ≤64 MiB. Stack peak RSS must be ≤3 GiB and mean CPU ≤1 core. After workload quiescence, application shutdown is ≤2 seconds, including the ≤1 second telemetry flush. Container teardown has a separate 30-second bound.

Healthy runs require zero lost expected records. Compare expected and queried multisets by canonical identity rather than counts alone. Allow a fixed 30-second query-visibility deadline after flush; record each bounded poll and its response. An exporter acknowledgment alone is not proof of ingestion. Fault runs must account for pending, exported, dropped and failed records, remain bounded and preserve command outcomes. Privacy leaks, context crossover and duplicate side effects each allow zero failures.

Retain every failed and inconclusive attempt. A correction requires a written hypothesis, changed input and fresh evidence. Never rerun an unchanged experiment to obtain a pass or revise thresholds retroactively. Queue drops, resource-cap failures, growth in component/event volume and material runtime/host changes trigger budget review. These are initial pilot targets, not permanent product limits.

### Qualification and delivery gates

Add source-only harness validation to development commands and CI before changing product behavior. Runtime qualification remains a separate Docker-dependent command; it must not silently skip required checks or convert absence into success. Preserve full Hub/shared checks and independent Standards and Specification reviews on the same committed comparison. Archive only after applicable acceptance evidence exists. Only a supported pilot may unblock downstream adoption.

## Risks / Trade-offs

- Automatic instrumentation can capture secrets before projection → disable unsafe receivers, project before every sink, seed adversarial headers/query/body/error fixtures and inspect both local and backend output.
- Timeouts can follow successful admission → preserve caller uncertainty and inspect the independent fake execution oracle without retrying commands.
- Backend buffering can conceal loss → use identity multisets and the fixed visibility deadline; retain missing records as failures or inconclusive evidence.
- Host contention can invalidate performance evidence → serialize heavy work, record host load and capacity, and preserve the affected attempt rather than retrying unchanged conditions.
- The development stack may exceed its initial budget → stop and report the failed target; adoption remains blocked pending an owner decision.

## Migration Plan

There is no live migration. Source delivery adds opt-in seams and disposable qualification tools. Run only against isolated synthetic state. Cleanup removes only resources named in the run manifest after saving bounded evidence; it must not prune shared images or remove another owner's resources. Rollback removes the optional pilot dependency/configuration without changing controller state or admission contracts.

## Open Questions

Docker engine availability remains an external execution prerequisite. It does not change the design or authorize enabling integration, installing infrastructure or changing security settings. Actual backend overhead and ingestion behavior are deliberately unresolved until measured.
