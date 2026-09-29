## Why

Ask the guide needs traceable issue and sub-guide facts before it can make
reliable recommendations. [Hub #543](https://github.com/jimmie-potts/agent-device-hub/issues/543)
owns this definition; GitHub and authored guide inputs remain authoritative.

## What Changes

- Define a versioned record schema, field-source dictionary and read-only access interface.
- Supply offline validation and synthetic success, invalid, unknown, stale and failure examples.
- Document operation-specific evidence gates and a public planning projection.
- Add maintenance guidance and execute the contract fixtures in existing CI.

## Capabilities

### New Capabilities

- `guide-records`: Source attribution, validation and evidence requirements for issue and sub-guide records.

### Modified Capabilities

None.

## Impact

The owning guide gains definition artifacts and tests; no production renderer,
normalizer, endpoint or model integration consumes them in this delivery.
There is no device contract change, new package, service or dependency.
Human approval of the exact definition precedes adoption. Cross-interface traces
describe obligations for later contracts without assigning them invented versions.
