## Why

[Roborock #376](https://github.com/jimmie-potts/agent-device-hub/issues/376), required by [epic #755](https://github.com/jimmie-potts/agent-device-hub/issues/755), must associate observed battery samples and capture a run-end map for an ordinary cleaning run. A completed cleaning record can end before the robot finishes returning; treating returning observations as part of the cleaning window prevents both outcomes.

## What Changes

- Retain returning status and battery originals while keeping the window used for cleaning-record association bounded by cleaning observations.
- Add a synthetic cleaning, return and dock regression proving observed battery eligibility and run-end capture, with the existing unverified map label.
- Preserve timestamps, private originals, unsupported controls, ambiguous-window refusals and startup history without retrospective maps.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `roborock-observations`: distinguish cleaning-record timing from return-to-dock observations when associating battery samples and admitting a current-map capture.

## Impact

The existing Roborock collector and its tests/documentation are affected. The archive format, private-file contracts, transport, SDK messages, content APIs, MCP interface and frontend ownership stay unchanged. Existing development and CI checks cover this behavior. Installed and app/map acceptance remain separate; original private observations and a missed capture are preserved without fabrication.
