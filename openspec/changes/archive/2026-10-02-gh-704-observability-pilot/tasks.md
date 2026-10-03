## 1. Reproducible inputs and validation commands

- [x] 1.1 Add source-only pilot validation and Docker-dependent qualification commands to development documentation and CI; verify command discovery and CI coverage before product behavior changes.
- [x] 1.2 Vendor the released observability 1.0.0 archive and source receipt, pin host instrumentation inputs, and verify checksum rejection plus clean external packaged-consumer installation.
- [x] 1.3 Encode the accepted thresholds and frozen protocol, including workload schedule, metric definitions and query deadline; verify deterministic calculations with passing, failing and missing-metric fixtures.

## 2. Command instrumentation and execution evidence

- [x] 2.1 Add opt-in Hub and controller-client diagnostic seams through a focused red-green loop; verify unchanged authentication, wire envelopes and disabled behavior, including callback invocation exactly once when telemetry fails.
- [x] 2.2 Add authenticated context adoption and exact-origin outgoing propagation; verify malformed/untrusted context, baggage/tracestate exclusion and concurrent context isolation.
- [x] 2.3 Extend the fake controller with a bounded execution queue and independent side-effect oracle; verify success, rejection, duplicate admission, concurrency and timeout-after-admission without automatic retry.
- [x] 2.4 Emit canonical manual and narrowly instrumented spans and Pino records through released mappings; verify Node 24 ESM startup, parentage, strict field validation and secret exclusion before sinks.

## 3. Bounded disposable harness

- [x] 3.1 Implement isolated backend launch and resource preflight using the pinned image, loopback listeners and task-owned manifests; verify refusal of unavailable prerequisites and unsafe network/resource configuration.
- [x] 3.2 Implement one bounded log path and a bounded trace path with safe drop/error accounting; verify saturation, absent/paused collection, exporter errors and shutdown deadlines with synthetic sinks.
- [x] 3.3 Implement expected-identity queries, Python fixture ingestion and existing viewer checks; verify query field mappings, deadline failure and missing/duplicate record detection in source tests.
- [x] 3.4 Preserve the original qualification branch and failed evidence; remove benchmark-only modules from the supported delivery surface while retaining functional adapters and checks. Paired performance qualification is deferred by the 2026-10-02 owner decision.
- [x] 3.5 Implement manifest-owned cleanup and run-data limits; verify unrelated resources survive, evidence persists and interrupted runs can be cleaned up within the stated ownership boundary.

## 4. Runtime qualification and disposition

- [x] 4.1 Once the existing container engine is available, freeze the pre-run manifest and verify real Loki/Tempo ingestion, Python/Node field queries, trace/log correlation and the existing Grafana viewer; retain exact query and viewer evidence.
- [x] 4.2 Run privacy, trust, context, queue/drop, exporter failure, timeout and cleanup scenarios against the real stack; verify zero leaks/crossover/duplicate effects and bounded truthful outcomes.
- [x] 4.3 Run the short final-candidate functional check and affected regressions; reuse applicable retained cross-language/viewer/fault evidence with exact revisions and limitations. Keep prior benchmark attempts inconclusive and performance unqualified.
- [x] 4.4 Publish the evidence-backed supported/refuted/inconclusive functional pilot report, deferred performance qualification and budget revisit triggers; verify that every mandatory gate is explicit and unsupported adoption remains blocked.

## 5. Delivery gates

- [x] 5.1 Run all applicable Hub, packaged-consumer, shared contract and workflow checks from the worktree; preserve command receipts and isolate unrelated failures.

Mandatory delivery sequence after implementation acceptance (not claims of completion):

1. Synchronize the affected specification and archive this exact change before final review; run strict OpenSpec/workflow validation and record the inventory.
2. Obtain independent Standards and Specification reviews of the same committed base/head, fix blockers, verify PR CI and guard the normal merge.
3. Verify applicable merged-revision CI and reconcile native issue/dependency records by readback. Only a supported functional pilot plus these delivery gates permits #705.

These post-implementation gates remain tracked in the PR and issue. Archiving the implementation artifacts does not satisfy or remove them.
