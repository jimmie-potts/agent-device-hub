## Why

The collector and authorized Hub routes expose private Wispr aggregates, but the
owner cannot inspect them in B.U.N.N.Y. Deliver the smaller first dashboard
approved in [Hub #471](https://github.com/jimmie-potts/agent-device-hub/issues/471).

## What Changes

- Add a source-granted Wispr route and a fixed numeric home widget in the existing shell.
- Show four date presets, app/category filters, core usage/timing totals, one daily
  trend, table-first vocabulary and separate cleanup/observed edits, numeric
  downloads, dictionary snapshots and explicit coverage.
- Keep filters in page memory independently from home. Retire sensitive reads
  and displayed text after permission loss, opt-out, source replacement or logout.
- Preserve the existing collector and Hub APIs. The owner-approved deferrals and
  revisit triggers live in the issue: extra charts, comparisons, custom dates,
  activity runs and dashboard text exports are outside this candidate.

## Capabilities

### New Capabilities

- `wispr-dashboard`: Private aggregate presentation, filter/export semantics,
  sensitive response lifecycle and accessible page/home behavior.

### Modified Capabilities

None. Existing routes and widget placements remain compatible.

## Impact

Changes are in apps/dashboard, its synthetic browser tests and owning guides.
The UI consumes the existing hub-wispr and wispr-contracts contracts without
changing Windows ownership or wire values. No new dependencies, collector,
service or device writer. Source delivery requires current-candidate UI approval,
independent review and CI; installation and personal-data validation remain #472.
