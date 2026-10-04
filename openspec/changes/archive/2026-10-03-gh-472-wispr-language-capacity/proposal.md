## Why

[Hub #472](https://github.com/jimmie-potts/agent-device-hub/issues/472) cannot complete installed language collection because overlapping rankings exhaust the collector's combined intermediate-key limit. The owner authorized the bounded aggregation repair after comparing full rebuilds and incremental processing.

## What Changes

- Build exact language rankings in sequential preset/corpus batches from repeatable retained-contribution reads.
- Limit each active batch to 250,000 ranking keys, releasing its maps before the next batch; document this explicit change from a cumulative per-snapshot limit.
- Preserve exact subgroup support, order, top 100, omitted counts, all 336 tables and existing publication/state semantics.
- Qualify diverse-text success, active-batch capacity failure, memory/time and native packaged operation; release a complete collector patch package.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wispr-language`: bounded exact ranking rebuilds with an explicit active-batch budget and last-good-state preservation.

## Impact

Collector language aggregation, retained-store iteration, synthetic tests, package version and runbook. No aggregate wire/schema, storage format, dependencies, source reader, privacy policy or Hub API change. Incremental counts, original-text retention (#776), phrasing (#786) and optional comparison work (#793) remain separate. Installed package identity/recovery and live acceptance remain required after source delivery.
