## MODIFIED Requirements

### Requirement: Granted source navigation and independent home summary
The shared runtime dashboard SHALL offer a module-owned React and TypeScript Wispr page and catalogued read-only home widget only when Wispr browser exposure is enabled. Authentication with read scope alone SHALL NOT bypass disabled exposure. The page SHALL preserve four preset and app/category filters in session memory independently of home's today/all-apps totals and seven-day trend. Inspection SHALL send no commands.

#### Scenario: Navigate away and return
- **WHEN** the owner selects 30 days and an app, opens Home and returns
- **THEN** the page retains that selection while Home shows today's words and speaking minutes across all apps, collection age and a page link

#### Scenario: No granted source
- **WHEN** no source is configured or Wispr browser exposure is disabled
- **THEN** no Wispr navigation or widget is exposed and a source deep link displays an unavailable address without analytics reads
