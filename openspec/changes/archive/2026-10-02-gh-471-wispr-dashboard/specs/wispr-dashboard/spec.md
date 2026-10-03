## Purpose

Present private Wispr usage, timing, vocabulary and observed edits in the existing dashboard, with explicit coverage and sensitive-data lifecycle boundaries.

## ADDED Requirements

### Requirement: Granted source navigation and independent home summary
The dashboard SHALL offer a distinct Wispr source route and catalogued read-only home widget only for a source granted by dashboard context. The page SHALL preserve four preset and app/category filters in session memory independently of home's today/all-apps totals and seven-day trend. Inspection SHALL send no commands.

#### Scenario: Navigate away and return
- **WHEN** the owner selects 30 days and an app, opens Home and returns
- **THEN** the page retains that selection while Home shows today's words and speaking minutes across all apps, collection age and a page link

#### Scenario: No granted source
- **WHEN** no source is configured or the credential lacks its grant
- **THEN** no Wispr navigation or widget is exposed and a source deep link displays an unavailable address without analytics reads

### Requirement: Coherent presets and honest numeric evidence
The page SHALL show words, dictations, speech and recording minutes, weighted speech WPM, average length/duration, active days, one daily trend and app/category tables from the same snapshot and selected period. It SHALL display reporting timezone, actual covered date span and sample denominators. Missing duration or unobserved dates SHALL NOT become zero. Preset windows SHALL respect reporting-zone calendar boundaries; unavailable portions remain explicit. Numeric CSV/JSON exports SHALL match the selected data and contain no language content.

#### Scenario: Partial coverage and DST
- **WHEN** a seven-day reporting-zone preset includes a DST transition or days outside captured coverage
- **THEN** daily grouping uses the producer's calendar dates, available dates are labelled, unobserved dates remain gaps, and exported selection agrees with the displayed captured totals

#### Scenario: Missing speech and empty selection
- **WHEN** selected dictations lack speech duration or no captured records match
- **THEN** WPM and duration display unavailable with coverage, while an observed empty matching selection is distinguished from unavailable source data

### Requirement: Qualified language and separate observed changes
The page SHALL show recognized speech, Flow output and observed-text vocabulary with all/useful word views and 2–5-word phrase tables, counts, distinct dictations, support threshold and omitted rank counts. Flow cleanup and observed edits SHALL remain separate with comparison coverage, token-change counters and common added/removed/replaced phrases. Stored Wispr counters SHALL be separate from derived rates. Finality SHALL remain unknown. The dashboard SHALL offer no text-export control or transcript drill-down.

#### Scenario: Suppressed or unavailable language
- **WHEN** collection/sharing is off, a preset is expired, input is unsupported or fewer than three dictations support a term
- **THEN** the page explains the corresponding state, retains usable numeric evidence and invents no rank, accuracy, sent-text or improvement claim

#### Scenario: Independent cleanup and later edits
- **WHEN** a fixture contains different recognition-to-output and output-to-observed replacements
- **THEN** the two tables show their own pairs and compared/changed denominators, and missing later observation is unknown rather than unchanged

### Requirement: Sensitive response retirement
The dashboard SHALL keep analytics only in memory. Logout, grant loss, source identity/generation changes and observed opt-out SHALL retire sensitive content and pending reads. A late response SHALL NOT restore retired text. Failed refreshes MAY retain same-selection numeric last-good evidence with its original collection time, but SHALL remove language content until positively revalidated. Hidden page DOM SHALL NOT retain language text after navigation or opt-out.

#### Scenario: Opt-out while language is in flight
- **WHEN** opt-out is observed before an earlier language read completes
- **THEN** no text from that read enters the page or hidden DOM

#### Scenario: Logout or removed grant
- **WHEN** the session ends or its source grant disappears
- **THEN** displayed data and pending analytics reads are retired and polling stops for that source

#### Scenario: Stale or replaced source
- **WHEN** a source is malformed, cleared, replaced or unavailable
- **THEN** any retained numeric evidence remains visibly stale with its original identity and time; obsolete source text cannot return

### Requirement: Compact coverage and accessible presentation
The page SHALL display collection time/age, latest activity date, captured/retained span, archived/current row counts, missing/skipped/gap evidence, schema/algorithm versions, sharing state and dictionary/snippet numeric snapshots with unknown counter windows. Charts SHALL have table alternatives and equivalent keyboard/touch values. Views SHALL work at wide, intermediate and 390px widths with reduced motion and WCAG 2.1 AA checks.

#### Scenario: Accessible daily values
- **WHEN** the owner uses keyboard or touch at phone width
- **THEN** every trend value is available through the table, labels remain readable and filters are operable without hover or color alone

#### Scenario: Dictionary snapshot
- **WHEN** a date or app filter changes
- **THEN** dictionary counters remain explicitly unfiltered snapshots with unknown usage windows and are neither summed nor assigned to that date range
