## Why

The Nanoleaf link maps a request deadline and several transport failures to the same unavailable result. [#1663](https://github.com/jimmie-potts/agent-device-hub/issues/1663) needs timing evidence to narrow what happens when a live Music read fails.

## What Changes

- Record bounded elapsed time, the read's source, the branch that settled the request and observations of local timer delay.
- Adopt diagnostic profile 1.10 for runtime records.
- Preserve the existing requests, deadlines, outcomes and availability behavior.

## Capabilities

### Modified Capabilities

- `nanoleaf-module` records timing for existing status and Music reads.
- `shared-observability-contract` adds a closed profile for the timing records.
- `bunny-runtime` writes records at profile 1.10.

## Impact

The Nanoleaf module and its local HTTP client supply timing evidence to the existing runtime diagnostic sink. Source validation uses synthetic reads. Installed diagnosis and physical acceptance remain open in #1663.
