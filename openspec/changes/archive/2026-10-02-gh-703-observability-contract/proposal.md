## Why

[Hub #703](https://github.com/jimmie-potts/agent-device-hub/issues/703) needs one queryable diagnostic form across B.U.N.N.Y.'s TypeScript, Python and browser components. A reviewed shared contract must precede the synthetic pilot and subsequent adoption, so privacy and correlation do not diverge between producers.

## What Changes

- Add a Hub-owned private observability artifact with strict JSON schemas, a registered event/resource/attribute catalog, TypeScript and Python validation/conversion, and a browser-safe core.
- Define canonical NDJSON, exact OpenTelemetry mappings, qualified trace propagation, bounded fail-open emission and explicit compatibility projections.
- Add shared positive/negative fixtures, cross-language query checks and immutable packaged-consumer tests.
- Document current producer seams and pure/no-op boundaries without claiming adoption. Preserve machine result, ready, IPC, proof and receipt protocols as separate non-diagnostic contracts.

## Capabilities

### New Capabilities

- `shared-observability-contract`: One privacy-preserving, versioned diagnostic profile and language/transport mappings with bounded optional instrumentation.

### Modified Capabilities

None. Controller and lifecycle envelopes, domain journals and device command semantics remain unchanged.

## Impact

New `packages/observability`, normative `docs/observability-contract.md`, package/fixture tooling, root build/test wiring and CI. Separate repositories consume immutable archives under existing private release conventions. This contract is the input to [#704](https://github.com/jimmie-potts/agent-device-hub/issues/704) and [#705](https://github.com/jimmie-potts/agent-device-hub/issues/705), coordinated by [#706](https://github.com/jimmie-potts/agent-device-hub/issues/706).

This change does not instrument running products, launch a collector, install hooks, migrate state, contact devices, capture real content, change visible UI or publish the work guide. Synthetic and source evidence cannot establish installed or physical coverage.
