## Why

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) needs measured early evidence and numeric limits before shared-core implementation. Hub #2 has delivered the lifecycle contract; actual legacy admission and released validators can now be measured without inventing a shared feed.

## What Changes

- Add reusable, bounded source measurement tools with exact source/package provenance, raw samples and explicit clock boundaries.
- Measure the supported available Windows/WSL paths using synthetic neutral metadata and isolated native storage. Report unavailable paths and excluded boundaries as missing evidence.
- Establish reviewed numeric latency, resource, queue and timeout budgets from matched observations before Hub #3 implementation.
- Retain real later-stage measurements as pending. This change covers only the early stage; the overall issue remains open for integrated qualification.

## Capabilities

### New Capabilities

- `shared-monitor-performance-baseline`: Reproducible early source measurements, evidence completeness and frozen budget requirements.

### Modified Capabilities

None. No shared core, producer transport, controller behavior or installation changes are introduced.

## Impact

Qualification tooling, tests, versioned measurement receipts, development/CI commands and performance documentation. Nanoleaf source is consumed unchanged at a pinned delivered revision; no personal state, devices or additional installed agent clients are involved. Missing Windows interop currently blocks complete matched measurements and budget acceptance, while independent Pixoo contract adoption may continue.
