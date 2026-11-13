## Why

An entity can flood retained history for days before the operator notices. [#1778](https://github.com/jimmie-potts/agent-device-hub/issues/1778) calls for an hourly warning while preserving every history row.

## What Changes

- Count committed change rows by writer, family, entity and UTC hour. Warn on row 121 through the SDK.
- Register the warning in an additive diagnostic profile and provide a query for the existing private Grafana viewer.

## Capabilities

### Modified Capabilities

- `bunny-runtime` gains the committed history alarm and its clock behavior.
- `shared-observability-contract` gains the diagnostic event and its allowed fields.

## Impact

The core history intake and observability workspace change. The SDK gains one log event. This is source delivery for the existing runtime and private diagnostic export.
