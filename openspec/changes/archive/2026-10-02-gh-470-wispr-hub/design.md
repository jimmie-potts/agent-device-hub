## Context

See proposal.md for motivation and #470 for acceptance. The Hub already checks bearer/session identity, read scope, registered source grants, Host/Origin and session retirement. The producer contract 1.0 supplies strict aggregate/status validators, numeric grouping, generation/revision identity and preset validity. Numeric and language availability are independent. Security and bounded file processing require this design artifact.

## Goals / Non-Goals

Goals: reuse existing authorization, preserve producer dates/coverage, isolate file parsing from the HTTP loop, and prevent retained text from bypassing a later opt-out or clear.

Non-goals: accessing SQLite, modifying producer state, adding runtime configuration APIs, installing anything, or implementing dashboard views/MCP analytics.

## Decisions

- Keep one optional `wispr` config with sourceId, aggregatePath, diagnosticsPath, freshnessMs (default 600000), exposeToDashboard and shareTextAggregates (both default false). Reject unknown keys, colliding source IDs, nonabsolute/non-JSON paths, Git/cloud paths, symlink redirects and identical file identities. Explicitly configured mounted Windows JSON is allowed; no arbitrary request paths.
- Use one worker thread for synchronous bounded regular-file reads, validation, immutable cached data and query projection. A single worker serializes reads; numeric refreshes coalesce for 30 seconds. Main-thread admission remains bounded; responses cap at 1 MiB and numeric rows at 10000. A worker deadline returns a sanitized unavailable response and retires that worker before another starts. This costs one thread when configured but avoids parsing up to 16 MiB on the HTTP loop. No second listener or durable Hub analytics database is needed.
- Read the small diagnostics manifest on each admitted query, including after projection before publication. Validate it and bind its namespace on first valid observation; later namespace changes require restarting with deliberately rebound configuration. Require nondecreasing revisions; generations fence cached data and pending exports. A new generation immediately discards the old cache even if its aggregate replacement is unavailable. Reject aggregate/manifest mismatch and old revisions. A missing/invalid manifest suppresses text while numeric data can remain visibly stale. File observation is a sampling boundary, not a guarantee against changes after the last read.
- Project status, summary, series, heatmap, apps, language and export from the same identified validated snapshot. Use inclusive producer-zone dates and app/category intersection. Clamp omitted bounds to captured coverage; reject invalid/reversed/out-of-coverage explicit ranges and unknown/repeated query keys. Language accepts exact today/7d/30d/all tables only, maps API `cleaned` to producer `formatted`, and never approximates groups by summing top-N lists. The compatible language profile is `english-1` / `english-stop-1`; unknown versions, missing tables and expired presets return typed reasons. Dictionary counters remain explicitly unfiltered snapshots with unknown windows.
- Keep source-specific `devices` grants in existing credentials. Launcher/trusted-loopback sessions acquire Wispr only when exposure is enabled; machine tokens still require their grant. Reauthorize after worker response and discard revoked pending replies. The main-thread response guard checks current sharing configuration, while the worker checks manifest opt-in. Configuration replacement is a server-owned lifecycle seam, not an HTTP operation; it retires browser grants, invalidates pending requests and destroys cached text. Restart also starts empty.
- Numeric JSON exports include identity, filters and coverage with selected numeric results. CSV uses a fixed long-form table for metadata, numeric values and explicitly requested text; quote every string, neutralize leading spreadsheet formula characters and use attachment/no-store/nosniff headers. JSON is served as JSON and never rendered as HTML. The dashboard must render text safely and clear client state on logout in its owning story.

## Risks / Trade-offs

- Windows atomic replacement can temporarily yield mismatched files → preserve last-good numeric data with a typed health reason; suppress text; retry within the refresh policy.
- A clear or opt-out cannot recall previously downloaded files → document this limitation; reject cached and pending exports after the new manifest is observed.
- Unknown edited-text semantics → preserve producer finality/coverage and unavailable tables; do not infer sent text, quality or improvement.
- A blocked filesystem can stall a worker → bound the HTTP wait, keep one worker until termination completes, and continue independent Hub routes. No unbounded replacement worker loop.
- Two config paths are owner-selected authority → validate file type, bounds, path boundaries and schema before any projection; never expose filesystem exceptions or private paths.

## Migration Plan

Worker recovery retains the accepted namespace/generation/revision in the Hub
process. The worker sends that metadata before its response, including after
observing a clear whose aggregate is unavailable. Replacements receive the
retained fence and start with an empty snapshot cache. No language or numeric
snapshot bytes enter this authority record.

Existing configs omit Wispr and retain existing behavior. Source delivery bundles the contract dependency in the offline Hub package. Installation and enabling either exposure or sharing require the separate owner-authorized runbook. Rollback removes the optional block when using an older package; it never changes collector data. No persistent Hub schema migration occurs.
