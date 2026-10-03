## Why

The accepted functional pilot demonstrates useful diagnostics, but normal application hosts do not yet own runtime configuration. [Hub #730](https://github.com/jimmie-potts/agent-device-hub/issues/730) makes that runtime reusable and enables practical Hub coverage, as the required input to Pixoo #134 and Nanoleaf #207.

## What Changes

- Add explicitly constructed Node/Python host runtimes to observability artifact 1.1.0; keep canonical schemas and the immutable 1.0.0 pilot artifact unchanged.
- Reuse bounded log/trace projection and transports, with local diagnostics, optional loopback OTLP export and 10% default head sampling.
- Wire normal Hub configuration to lifecycle, request/controller/MCP and owned background diagnostics while preserving output and domain behavior.
- Document enable/disable, coverage, package checks and existing query use. No installation, UI change or performance campaign.

## Capabilities

### New Capabilities
- `shared-observability-host`: explicit reusable runtime construction, bounded output/export and cross-language packaged consumers.

### Modified Capabilities
- `standalone-hub-host`: opt-in normal host configuration and operational coverage.

## Impact

`packages/observability`, artifact packaging, Hub CLI/server diagnostics and owning checks/docs/CI. Consumers use a new immutable release only after review and merged CI. Existing [observability contract](../../../docs/observability-contract.md), controller/lifecycle wire values, state ownership and device queues remain unchanged. Current Nanoleaf is Linux-only per its owning repository; older planning context is historical.
