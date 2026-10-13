## Why

The selected S8 MaxV Ultra uses L01 on its local socket, while the shipped transport sends `1.0`. Correct this compatibility gap under [Hub #376](https://github.com/jimmie-potts/agent-device-hub/issues/376) without changing the existing V1 account or vendor-map route.

## What Changes

- Allow an explicit optional private target `localProtocol` of `1.0` or `L01`, defaulting to `1.0`.
- Authenticate L01 publish frames with AES-256-GCM and connection nonces, using the existing allowlisted reads and bounded socket lifecycle.
- Preserve legacy framing, cloud map reads and private input validation; retain synthetic protocol provenance and regression evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `roborock-read-transport`: explicit local framing selection and authenticated L01 responses.

## Impact

Private target validation, transport codec/socket and their existing module consumers. No new dependency, shared message/API contract, state schema or architectural ownership change. Account sessions retain protocol `1.0`; installed and physical acceptance remain separate.
