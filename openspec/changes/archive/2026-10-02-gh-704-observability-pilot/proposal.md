## Why

[Hub #704](https://github.com/jimmie-potts/agent-device-hub/issues/704) must establish whether the shared diagnostic contract helps an operator follow a real Hub command path without changing its outcomes, using the owner-approved practical functional scope. The [#703 artifact](https://github.com/jimmie-potts/agent-device-hub/releases/tag/bunny-observability-v1.0.0) is delivered; contract fixtures alone do not establish backend ingestion. Numerical overhead qualification is deferred by the owner-approved scope revision of 2026-10-02.

## What Changes

- Add explicitly enabled diagnostic seams for the existing authenticated Hub brightness command and controller client, with no default exporter or visible UI change.
- Extend the existing fake controller with bounded synthetic queue/execution evidence and an independent side-effect oracle; preserve native ticket admission and replay behavior.
- Add a disposable Linux/WSL harness using the pinned LGTM development image, canonical Pino JSON through one Collector log path, manual OpenTelemetry spans and narrowly filtered HTTP/Undici instrumentation.
- Provide executable field queries, existing Grafana Explore verification, representative success/failure checks and a short final-candidate functional smoke. Reuse applicable existing evidence; do not require paired benchmarks.
- Retain raw failed/inconclusive attempts, exact versions, checksums, cleanup evidence and a supported/refuted/inconclusive functional result. Explicitly label performance unqualified. Preserve the benchmark framework in history rather than treating it as the supported runtime interface. Missing Docker leaves runtime qualification unexecuted.

## Capabilities

### New Capabilities

- `shared-observability-pilot`: Isolated synthetic command qualification, bounded telemetry ingestion, query/privacy/fault checks and reproducible adoption-gate evidence.

### Modified Capabilities

None. The shared observability profile and controller/lifecycle wire requirements remain unchanged. Hub command admission, ownership, authentication and truthful uncertainty retain their existing requirements.

## Impact

Affected areas are `apps/hub`, its fake-controller fixtures, a bounded harness under `scripts/observability`, development/CI commands, immutable vendor inputs and issue-linked OpenSpec artifacts. The harness consumes observability 1.0.0 with its receipt/checksums; it does not copy an unversioned component dialect. Public OTel dependencies require exact pins and Node 24 ESM startup qualification.

[Parent #706](https://github.com/jimmie-potts/agent-device-hub/issues/706) remains open until the required source outcome is delivered. [Adoption #705](https://github.com/jimmie-potts/agent-device-hub/issues/705) cannot proceed without a supported pilot. Pixoo/Nanoleaf adoption, live services, personal hooks/settings, state migration, physical devices, real content capture, system infrastructure/security changes, custom dashboards, Project commitments and work-guide publication are outside this change.
