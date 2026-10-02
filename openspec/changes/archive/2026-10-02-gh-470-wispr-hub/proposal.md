## Why

The private Windows collector produces validated aggregates, but the Hub cannot yet serve them to an authorized dashboard. [Hub #470](https://github.com/jimmie-potts/agent-device-hub/issues/470) supplies that read-only boundary while keeping source databases and individual dictations on Windows.

## What Changes

- Add optional private file configuration and source-specific grants using existing Hub credentials and browser sessions.
- Validate and cache the collector contract with bounded off-thread reads, truthful freshness, generation fencing and immediate text suppression on observed opt-out.
- Serve status, numeric summaries/series/heatmaps/apps, optional preset language tables and explicitly selected CSV/JSON exports.
- Bundle the producer validator and synthetic fixtures in the offline Hub archive; test authorization, failure, revocation and responsiveness through real HTTP.

## Capabilities

### New Capabilities

- `hub-wispr`: source-authorized aggregate file reads and exports with privacy, freshness and capacity bounds.

### Modified Capabilities

None. Existing controller, lifecycle, agent-state and MCP wire contracts stay intact.

## Impact

Affected areas are `apps/hub`, the Hub package/lockfile and package builder, existing Hub CI suites, and owning guides. The dependency is `@jimmie-potts/wispr-contracts` 1.0.0. The later dashboard consumes the new route family. No source database, installation, recurring collector, personal data or device operation is involved.
