## Why

[Hub #376](https://github.com/jimmie-potts/agent-device-hub/issues/376) gives the owner a read-only view of the S8 MaxV Ultra's status and retained cleaning history in B.U.N.N.Y. The source transport from [#1070](https://github.com/jimmie-potts/agent-device-hub/issues/1070) supplies the six bounded reads; collection, private persistence, the page and MCP integration still need an owning module.

## What Changes

- Ship a configured TypeScript `roborock` module with one serialized collector and an inert, injected transport for synthetic runs.
- Retain original readings, cleaning records, observed battery samples, room mappings and candidate run-end map captures in the module's private SQLite. Preserve gaps, timestamps and unknown values across restart.
- Publish complete revisioned `roborock-vacuum/2.0` status beside the existing generic device record. Serve bounded, paged history and samples through authenticated module content reads.
- Add the module's React status page and read-scoped `roborock_status` tool, using the existing shell connection and the same current record.
- Add meaningful module, contract-consumer, browser and runtime scenario checks, plus private backup/recovery instructions and source qualification limits.

Vacuum controls, map display, photos, room coverage, widgets and live occurrences remain outside this change. Current maps retain candidate association evidence; the protocol supplies no run identifier, so source checks cannot establish physical attribution.

## Capabilities

### New Capabilities

- `roborock-observations`: read-only collection, private cleaning history, truthful freshness and association evidence, and the module page/MCP journey.

### Modified Capabilities

None. The existing transport, generic device family, SDK registration and runtime read interfaces retain their requirements.

## Impact

`modules/roborock` gains a registered root package, its own schemas and a browser-only frontend export; the nested transport package remains its read boundary. Root workspace/build/check scripts, CI, development documentation and the runtime's synthetic scenario/browser harness gain this module's coverage. No shared SDK or gateway API, port, controller v1 contract, Python service or cross-repository contract changes are planned.

Source delivery follows ADRs 0011/0012 and the current runtime guides. It neither uses the owner's account nor contacts the robot. Installation and a real-run comparison retain the exact issue's separate authority and evidence requirements.
