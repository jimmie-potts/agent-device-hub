## Context

History writes in the same SQLite transaction as the core change. The core store verifies the commit before starting publication. Its logger already uses the SDK and the shared diagnostic contract.

## Decisions

- Collect the designated entity key at each successful change insert. Consume those keys after the store verifies the commit and updates its bookkeeping. A rollback discards the staged keys, and the alarm adds no database work.
- Use the committed rows' intake clock for two UTC-hour buckets. A reversal into a retained bucket keeps its counts. A larger reversal resets the buckets so a mistaken future clock cannot suppress later warnings. A discarded hour can warn again if revisited and 121 more rows commit.
- Use profile 1.9 for the new event and approved metadata. The SDK assigns WARN. The existing core logger sends the event to the journal and the configured private export. Missing correlation stays absent, and a failed sink leaves committed work intact.
- Query received warnings in the existing private Grafana viewer, as selected by the owner. The event has no domain outcome. The query uses registered metadata and reports received warnings, since the pipeline may filter or drop records.

## Deployment

No state migration is required. Source validation uses synthetic records. Installed diagnostic visibility is checked in the separate deployment batch.
