## Why

[#1040](https://github.com/jimmie-potts/agent-device-hub/issues/1040) needs retained title observations from standard YouTube and Stremio, so history remains available without an open dashboard. The accepted [qualification contract](../../../docs/onn-history-qualification.md) selects the fixed read-only reader and distinguishes selected titles and reported progress from watched time.

## What Changes

- Extend the existing ONN owner with explicitly enabled, serialized five-second metadata collection through private ADB and the fixed, release-pinned Java/Dex reader.
- Retain credential-excluded original observations, local occurrences and gaps indefinitely in the module's existing leased private SQLite database.
- Expose honest current content and bounded stored-data history/detail queries through the existing authenticated content and MCP contributions.
- Preserve controls, physical-remote use, tracked outcomes and no command replay. Collection failures cannot block controls.
- Leave watched-time totals, completion, ad classification/Skip, inferred topics, recommendations and Google TV-link research deferred. Installation and physical acceptance remain under #1044; React history views remain under #1041.

## Capabilities

### New Capabilities

- `onn-title-history`: fixed collection, immutable private originals, occurrence identity, freshness/gaps and bounded authenticated history/detail reads.

### Modified Capabilities

None. Existing ONN control requirements and shared SDK/gateway contracts remain in force.

## Impact

Changes stay in `modules/onn` and its existing runtime scenario/protocol fixtures, with small additions to root validation commands, CI and the development guide. The reader's Java source, fixed Dex and build/provenance tests form one scoped native dependency; the module and runtime remain TypeScript. No controller contract, lockfile dependency, database owner, installed configuration or device changes follow from source delivery. Independent source and disposable Acceptance reviews remain required.
