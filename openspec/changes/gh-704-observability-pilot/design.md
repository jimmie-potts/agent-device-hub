## Context

See proposal.md for motivation. The Hub authenticates requests before its controller-command route. Its controller client validates native envelopes, holds one request slot and times out without retrying. The existing fake controller uses reference ticket admission and replay, but a queued receipt does not prove execution. Observability 1.0.0 is released at Hub revision `673a297ad1225cd18b611de8969dea10b28d33f2`.

The owner approved a practical scope reset on 2026-10-02 after reviewing the cost of the qualification framework. Current #704 acceptance requires useful functional evidence and normal delivery gates; the original paired-performance thresholds are deferred, not passed. Preserve the original protocol, branch and all failed attempts. Existing resource caps and implemented contract protections remain. Do not add a new privacy campaign or general-purpose evaluation subsystem.

## Goals / Non-Goals

**Goals:** Demonstrate the real authenticated Hub command path, preserve its outcomes under telemetry failure, and make a supported/refuted/inconclusive result reproducible from retained evidence.

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

Use `grafana/otel-lgtm:0.34.0` at Linux amd64 digest `sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b`. Record its parent manifest digest and component versions. Publish only explicitly selected loopback ports on a fresh task-owned ordinary bridge. The owner approved this profile after the internal bridge produced no actual host mappings in a retained prerequisite smoke. Outbound connectivity is possible; use only synthetic data and keep analytics disabled. Verify actual Docker mappings and host-side HTTP readiness before workloads. Do not change daemon, firewall or host security settings. Do not use privileged mode, host networking, host PID access or device access. Account for all bundled stack services.

Disable Grafana plugin preinstallation and automatic plugin updates in the disposable profile. Use the datasource plugins bundled in the pinned image; do not download unpinned replacements at startup. A retained prerequisite run exposed configured datasources missing from the frontend registry. The upstream auto-update failure report is a correction hypothesis, not proof of this host's exact failure cause: https://github.com/grafana/grafana/issues/132528. Verify both frontend registration and actual Explore queries before qualification.

Restrict Loki index labels to stable service namespace/name/environment. Preserve request, ticket, trace and span identifiers as queryable metadata rather than indexed labels. Document Loki dot-to-underscore and numeric conversion mappings. Verify the existing Grafana Explore log/trace links without adding a dashboard or changing product UI. Python fixtures must reach the same field queries as Node records.

Disable Docker's log driver for the development backend. Its daemon-owned log files are outside both container writable-layer and data-volume accounting. Application canonical log capture and Collector ingestion remain enabled as specified. This removes the extra backend console copy from disk accounting; backend diagnostics must use service health, query responses and any owned files. Account run data using the larger of allocated/apparent volume bytes, writable-layer size and owned host run files. Qualify the fixed read-only storage probe in the pinned image before workloads; missing utilities or measurements leave the run unqualified. This changes no accepted threshold and precedes every measured run.

Keep at least 8 GiB host-available RAM. Hard-limit the stack to two CPUs and 4 GiB RAM; permit at most 10 GiB image storage and 2 GiB run data. Stop on a cap breach and retain evidence. Keep durable evidence under the main checkout's `.local/evidence/`. The Hub refuses state inside any Git checkout, so put its disposable state in the parent workspace's `.local/scratch/o704` (or a run-owned sibling), outside every checkout. Other task-owned files use disk-backed `.local/`; all credentials are synthetic. Run heavy builds and measurements serially. An unbounded default upstream launcher was rejected because its network and resource settings do not meet this experiment's constraints.

### Practical functional acceptance

Reuse qualified Node/Python ingestion, existing Grafana Explore screenshots and command/Collector fault evidence when relevant code is unchanged. Record original revisions and affected validation after changes. Run a short final-candidate synthetic command check; verify representative correlated fields, independent fake effects and cleanup. Normal source regression tests cover unavailable export and bounded shutdown. No repeated full fault campaign or paired measurements are required.

The supported interface should be the common logging/tracing adapters, opt-in host configuration, pinned local backend and simple functional qualification commands. Remove benchmark-only scheduling/sampling/orchestration from the delivery surface; retain recoverable source at `archive/gh-704-full-qualification-20261002` (3e2f363) and durable raw evidence. Shared modules needed by functional checks remain; do not build replacements merely to reduce file count.

The first paired suite dispatched no commands due to an early timer-wakeup defect. The corrected suite failed backend readiness before workload execution. Both remain inconclusive. Later bounded health diagnostics passed but did not establish the cause. No overhead measurement is claimed. The owner-approved scope change retires the numerical gate for this delivery rather than changing old results.

Keep host/resource caps and one-second flush/two-second application shutdown safeguards. Resource ownership checks remain when needed to avoid affecting unrelated services. Improve diagnostics only when a failure blocks the short functional check; do not continue expanding the harness preemptively.

### Pinned backend query mapping

Loki 3.7.8's native OTLP importer copies severity and trace identity but does not
retain `LogRecord.EventName`. Preserve the accepted query field with the fixed
Collector statement `set(log.attributes["event_name"], log.event_name)` before
batching logs. Keep error propagation explicit. This mapping changes no producer
schema, privacy allowlist or benchmark threshold; qualify the exact Collector
configuration for functional checks. Preserve previous configuration receipts.

Read categorized Loki structured metadata with an explicit instance ID and
nonoverlapping ten-second windows. Compare canonical field projections as
multisets, including event identity, rather than matching body text or counts.
Normalize Tempo V2's exact hex/base64 IDs and reject partial results. Bound query
responses and retain each observation within the accepted 30-second visibility
window. Ingestion-only satisfaction still requires representative failure evidence and source-delivery gates.

### Qualification and delivery gates

Add source-only harness validation to development commands and CI before changing product behavior. Runtime qualification remains a separate Docker-dependent command; it must not silently skip required checks or convert absence into success. Preserve full Hub/shared checks and independent Standards and Specification reviews on the same committed comparison. Archive only after applicable acceptance evidence exists. Only a supported functional pilot and its source-delivery gates may unblock practical adoption.

## Risks / Trade-offs

- Automatic instrumentation can capture secrets before projection → disable unsafe receivers, project before every sink, seed adversarial headers/query/body/error fixtures and inspect both local and backend output.
- Timeouts can follow successful admission → preserve caller uncertainty and inspect the independent fake execution oracle without retrying commands.
- Backend buffering can conceal loss → use identity multisets and the fixed visibility deadline; retain missing records as failures or inconclusive evidence.
- Overhead is unqualified → document that limitation and revisit from observed daily-use problems rather than claiming a performance pass.
- The development stack may exceed its initial budget → stop and report the failed target; adoption remains blocked pending an owner decision.

## Migration Plan

There is no live migration. Source delivery adds opt-in seams and disposable qualification tools. Run only against isolated synthetic state. Cleanup removes only resources named in the run manifest after saving bounded evidence; it must not prune shared images or remove another owner's resources. Rollback removes the optional pilot dependency/configuration without changing controller state or admission contracts.

## Open Questions

Docker engine availability remains an external execution prerequisite. It does not change the design or authorize enabling integration, installing infrastructure or changing security settings. Backend overhead remains unqualified. Actual ingestion has retained evidence and is rechecked where the delivered candidate changes it.

### Collector fault qualification

Retained paused and absent collection checks used separate fresh backends;
reuse their evidence where the final source remains applicable. Verify the pinned Collector executable and its PID/start time inside
the owned container before sending STOP or TERM. Do not pause the container:
its storage/resource watchdog must continue. Restore a paused Collector with
CONT and health readback; otherwise retain the failure and use bounded container
teardown. Never retry an ambiguous signal.

Each condition uses two fresh applications, disabled then enabled, with 200
sequential brightness commands and no retries. This saturation sequence is
separate from the frozen performance workload. Require identical domain
outcomes, exactly 200 effects per mode, expected diagnostic structure, complete
identity accounting, zero falsely acknowledged exports, exporter failures and
the accepted shutdown bounds. Paused collection must also demonstrate queue
drops. Failure to establish any required observation retains a failed result;
it does not authorize increasing the sequence until it passes.

The saturated runtime exposed 4.6 ms of finalization after the queue's original
1,000 ms wait, so that attempt failed the accepted flush bound. Retain it as
failed evidence. Pilot application queues now wait at most 950 ms, reserving
50 ms for drop accounting and SDK cleanup. The measured end-to-end flush bound
remains 1,000 ms; queue capacities, command timeouts and workload are unchanged.
Retain this setting in the delivered opt-in runtime.

Runtime fault evidence is retained under the main checkout's
`.local/evidence/gh-706-observability/`: `704-command-faults-001` matched all 49
logs and 48 spans for ten command/privacy/context scenarios; `704-paused-collector-004`
and `704-absent-collector-001` each preserved 200 effects per mode and accounted
for all 1,400 logs and 1,200 spans. The paused run recorded bounded drops and a
955.184 ms flush; the absent run classified all records as failed exports and
flushed in 7.143 ms. Both restored or removed their owned runtime as applicable
and verified resource/state cleanup. Full-precision measurements remain in the
raw evidence; these rounded values are descriptive only.

Retain paused attempts 001 (socket-path startup failure), 002 (1,004.608 ms
flush, failed), and 003 (pre-allocation prerequisite refusal with incomplete
diagnostic evidence), together with their correction hypotheses and source
regressions. They are not passing runs. No paired benchmark or full pilot
acceptance follows from these fault results.
