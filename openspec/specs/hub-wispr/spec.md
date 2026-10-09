# hub-wispr Specification

## Purpose

Expose private Wispr aggregate analytics through the existing Hub with source-specific authorization, truthful observation freshness and independent text-sharing permission.

## Requirements

### Requirement: Configured source authorization

The runtime SHALL read only the owner's configured aggregate and diagnostics JSON files. Every analytics response MUST require an authenticated caller with runtime read scope; no separate Wispr client allowlist or source grant SHALL be required. Browser sessions SHALL receive analytics and page discovery only when dashboard exposure is enabled. Exposure and text sharing SHALL default off independently. Source IDs SHALL be neutral and SHALL NOT collide with reserved host identities. Existing Host, Origin and Fetch-Metadata checks SHALL remain. Analytics SHALL NOT enter MCP, agent-session snapshots or general broadcasts. Released old Hub routes SHALL retain their existing authorization until cutover.

#### Scenario: Generic and wrong-source credentials
- **WHEN** two authenticated runtime clients with read scope and no extra Wispr grant request analytics
- **THEN** both receive permitted numeric analytics, including while browser exposure is disabled

#### Scenario: Refused callers and disabled browser exposure
- **WHEN** a caller is anonymous, revoked, lacks read scope, has a retired browser session, or is a browser while exposure is disabled
- **THEN** no Wispr analytics payload is delivered; disabled exposure also hides the browser page and widget

#### Scenario: Late revocation
- **WHEN** a credential, read scope or session is revoked, browser exposure is disabled for a browser, or text sharing is disabled while a read/export is pending
- **THEN** the pending response is refused before delivering data whose permission ended

### Requirement: Bounded immutable file observations

The Hub SHALL validate the producer's versioned contract and source identity before replacing a snapshot. Input SHALL be limited to 16 MiB and diagnostics to 4096 bytes, with bounded structure and processing outside the HTTP event loop. Only regular configured files SHALL be read; unsafe paths and redirections SHALL reject. The Hub SHALL serialize source reads and coalesce ordinary numeric refreshes for 30 seconds. Responses SHALL be at most 1 MiB and numeric selections at most 10000 rows; excess selections SHALL return a typed capacity reason without truncation.

#### Scenario: Malformed replacement
- **WHEN** a valid snapshot is followed by missing, locked, malformed, oversized, unsupported or older input
- **THEN** last-good numeric data retains its original identity and age with a sanitized failure reason, while an initial failure returns unavailable instead of zero

#### Scenario: Slow source
- **WHEN** simultaneous analytics clients encounter a slow source read
- **THEN** work and response time remain bounded and independent health/device requests continue

### Requirement: Clear and text permission fencing

An observed generation change SHALL invalidate the old dataset and all pending exports. Older revisions SHALL not replace newer accepted data. Text SHALL require both current Hub sharing permission and a valid matching producer manifest with language enabled. Missing permission evidence SHALL suppress and evict text, including pending responses, without deleting numeric producer history. Responses and exports SHALL use no-store caching.

#### Scenario: Clear while aggregate unavailable
- **WHEN** a new-generation manifest arrives while its aggregate is missing or invalid
- **THEN** the Hub returns unavailable and never falls back to the cleared generation

#### Scenario: Text disabled with retained numeric snapshot
- **WHEN** language collection or Hub text sharing is disabled while a cached snapshot contains language tables
- **THEN** text is absent from subsequent routes and pending exports; numeric history remains available subject to freshness and identity checks

### Requirement: Consistent numeric queries

`GET /api/wispr/v1/status`, `summary`, `series`, `heatmap` and `apps` SHALL expose the same validated source/generation/revision, producer timezone, last-success time, latest source activity date, coverage and freshness. Numeric filters SHALL accept inclusive from/to dates and app/category intersection. Invalid, duplicate, unknown or unsupported filters SHALL reject. Series SHALL support day, week and month; heatmaps SHALL include local hour and weekday. Unknown duration/counter values SHALL remain distinct from zero, with matching weighted-rate denominators. Dictionary counters SHALL remain unfiltered snapshots with explicit unknown windows.

#### Scenario: Shared filter math
- **WHEN** summary, series, apps, heatmap and export receive the same app/category and date selection
- **THEN** their totals and identity agree exactly with the producer fixture

#### Scenario: Dates and incomplete coverage
- **WHEN** a requested interval is reversed, invalid or outside captured coverage
- **THEN** the route rejects it with a typed reason; missing observations are never presented as observed zeros

### Requirement: Exact language preset selection

The language route SHALL accept period today/7d/30d/all, raw/cleaned/observed corpus and app/category intersection. It SHALL return only the matching precomputed subgroup with suppression and provenance. Custom lexical dates SHALL reject. Missing language support or subgroup SHALL report unavailable; expired presets SHALL retain their actual as-of date and never be relabelled today. Observed edits SHALL preserve unknown finality.

#### Scenario: Numeric-only producer
- **WHEN** a valid producer snapshot has no available language analysis
- **THEN** numeric routes work and language returns an explicit unavailable reason

#### Scenario: Stale lexical preset
- **WHEN** the requested preset has passed its producer valid-until time
- **THEN** its as-of metadata remains truthful and no current-period ranking is claimed

### Requirement: Authorized portable exports

The export route SHALL accept JSON or CSV, numeric by default, using the same filters, coverage and identity as the read routes. Text export SHALL require explicit includeText=true and both text permissions. CSV SHALL quote fields and neutralize spreadsheet formulas. Responses SHALL use the correct MIME type, attachment and nosniff headers. No path, raw transcript, individual event ID/timestamp, unknown input field or filesystem diagnostic SHALL appear.

#### Scenario: Numeric export by default
- **WHEN** a fully authorized caller exports without explicitly including text
- **THEN** the export contains selected numeric aggregates and no language content

#### Scenario: Canary and formula safety
- **WHEN** fixtures contain injected paths/secrets, unsupported fields, HTML and formula-like text
- **THEN** unsupported payloads reject without echoing values, valid text remains inert data, and CSV cells cannot execute formulas

### Requirement: Offline consumer qualification

The reproducible offline Hub archive SHALL contain the producer validator and synthetic fixtures, and SHALL pass the same source authorization, query and privacy tests when installed into a disposable consumer. Source tests SHALL not claim installed personal-data, recurring collection or physical acceptance.

#### Scenario: Offline consumer
- **WHEN** the package is extracted without network access and serves synthetic collector output
- **THEN** the real Hub routes validate and project the fixture with the same results as the source suite
