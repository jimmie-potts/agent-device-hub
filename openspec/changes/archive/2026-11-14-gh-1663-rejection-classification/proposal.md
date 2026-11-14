## Why

The existing timing records in [#1663](https://github.com/jimmie-potts/agent-device-hub/issues/1663) distinguish the two application timers from an ordinary rejection. The generic rejection still combines several local HTTP and response handling boundaries.

## What Changes

- Record a fixed stage and coarse category for a generic rejection on an existing timed read.
- Retain counts by class through ordinary recovery, including short mixed failure runs.
- Add diagnostic profile 1.11 with explicit projection to 1.10.

## Capabilities

### Modified Capabilities

- `nanoleaf-module` classifies read rejections without changing settlement.
- `shared-observability-contract` admits the new fixed vocabulary.
- `bunny-runtime` adopts profile 1.11.

## Impact

The local HTTP client and runtime diagnostics are affected. The experiment to narrow the installed cause remains open.
