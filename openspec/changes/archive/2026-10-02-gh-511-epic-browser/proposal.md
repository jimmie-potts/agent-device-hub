## Why

[Hub #511](https://github.com/jimmie-potts/agent-device-hub/issues/511) needs a complete epic browser built on the owner-approved #545 definition. The old topic Guide remains available until the separate cutover.

## What Changes

- Add a paginated public GitHub collector, normalization, inventory audit and atomic last-good candidate generation.
- Add home, epic, standalone, all-issues and deterministic composed pages using shared cards, rows, dependencies and task briefs.
- Pin records, catalog, page models and assets to one release; preserve navigation, search, theme, keyboard and print behavior.
- Add adapter, negative-projection and browser checks to the existing CI.

## Capabilities

### New Capabilities

- `epic-browser`: Collector and browser behavior for the accepted epic Guide contracts.

### Modified Capabilities

None. The approved #545 and legacy #543 definitions remain unchanged.

## Impact

New code and candidate under docs/work-guide, validation in docs/development.md and Depot CI, and one issue-linked OpenSpec change. No installation, public deployment, Project editing, model endpoint or root-site cutover. #540 owns Project enrichment, #654 hosted validation, #317 publication and #656 cutover.
