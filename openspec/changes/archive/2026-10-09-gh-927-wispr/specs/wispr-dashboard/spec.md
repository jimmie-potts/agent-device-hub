## MODIFIED Requirements

### Requirement: Granted source navigation and independent home summary
The shared runtime dashboard SHALL offer a module-owned React and TypeScript Wispr page and catalogued read-only home widget only when Wispr browser exposure is enabled. Authentication with read scope alone SHALL NOT bypass disabled exposure. The page SHALL preserve four preset and app/category filters in session memory independently of home's today/all-apps totals and seven-day trend. Inspection SHALL send no commands.

#### Scenario: Navigate away and return
- **WHEN** the owner selects 30 days and an app, opens Home and returns
- **THEN** the page retains that selection while Home shows today's words and speaking minutes across all apps, collection age and a page link

#### Scenario: No granted source
- **WHEN** no source is configured or Wispr browser exposure is disabled
- **THEN** no Wispr navigation or widget is exposed and a source deep link displays an unavailable address without analytics reads

### Requirement: Sensitive response retirement
The dashboard SHALL keep analytics only in memory. Logout, loss of read access, source identity/generation changes and observed opt-out SHALL retire sensitive content and pending reads. A late response SHALL NOT restore retired text. Failed refreshes MAY retain same-selection numeric last-good evidence with its original collection time, but SHALL remove language content until positively revalidated. Hidden page DOM SHALL NOT retain language text after navigation or opt-out.

#### Scenario: Opt-out while language is in flight
- **WHEN** opt-out is observed before an earlier language read completes
- **THEN** no text from that read enters the page or hidden DOM

#### Scenario: Logout or removed grant
- **WHEN** the session ends, its runtime read scope ends, or browser exposure is disabled
- **THEN** displayed data and pending analytics reads are retired; no late reply can restore them

#### Scenario: Stale or replaced source
- **WHEN** a source is malformed, cleared, replaced or unavailable
- **THEN** any retained numeric evidence remains visibly stale with its original identity and time; obsolete source text cannot return
