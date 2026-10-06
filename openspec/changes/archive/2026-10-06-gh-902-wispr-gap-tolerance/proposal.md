## Why

Installed day observation for [Hub #472](https://github.com/jimmie-potts/agent-device-hub/issues/472) shows that collector 1.1.4 marks on-time five-minute collections as `not-observed` gaps; [Hub #902](https://github.com/jimmie-potts/agent-device-hub/issues/902) tracks the bug. Successful observations finish a few seconds after each task start, so their spacing jitters around 300 s. The current rule treats anything over exactly 300,000 ms as unobserved and merges consecutive gaps, so a fully observed day shows as mostly missing.

## What Changes

- Count an interval between successful observations of up to 450,000 ms (1.5 times the planned five-minute cadence) as observed.
- Keep recording longer intervals, such as one missed run, sleep or a stopped task, as `not-observed`. Keep failed attempts recorded as `failed-attempt` regardless of interval. Keep consecutive same-reason gaps merging.
- Release collector 1.1.5 through the existing reproducible package.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wispr-collector`: truthful freshness defines the observation tolerance for gap records.

## Impact

The collector store, its synthetic tests, the package version/lock entry, the package builder, developer guidance and the collector specification change. Wire schema, storage schema, algorithm identifiers, the gap shape and Hub consumers remain compatible. Already published gap records are not rewritten. Installation of 1.1.5 and its day observation remain under #472.
