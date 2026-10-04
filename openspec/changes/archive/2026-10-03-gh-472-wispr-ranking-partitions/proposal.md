## Why

Installed acceptance for [Hub #472](https://github.com/jimmie-potts/agent-device-hub/issues/472) shows that collector 1.1.3 still rejects one preset/corpus ranking batch at its 250,000-key bound. Source reading and numeric aggregation pass, but exact language collection needs smaller working sets while preserving all retained history and current resource budgets.

## What Changes

- Retry an excessive preset/corpus batch using sixteen deterministic, disjoint ranking-key partitions; retain the normal single-pass path for batches that fit.
- Merge bounded partition candidates into exact global top-100 tables, summing qualified counts for omitted values and counting coverage/comparisons once.
- Keep the 250,000 simultaneously active-key bound per partition, all existing source/run/memory/store/publication limits, and fail visibly if a partition cannot fit.
- Qualify synthetic adversarial overflow, exact ranking/support/ties/coverage, transactional rollback, repeated readers, native resources and complete collector 1.1.4 packaging.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wispr-language`: bounded exact ranking rebuilds use smaller working partitions before rejecting a large batch.

## Impact

The collector aggregation module, synthetic/native fixtures, package version/lock entry, package builder, developer guidance and language specification change. Wire schema, storage schema, algorithm identifiers and Hub consumers remain compatible. The Windows collector remains the only analytics writer; WSL receives only the approved aggregate contract. No source mutation, limit increase, pruning, approximate counts, original-text retention, incremental ingestion or new service is introduced. Installed replacement still requires the owner's package/recovery checkpoint; private trial and task/day acceptance remain separate.
