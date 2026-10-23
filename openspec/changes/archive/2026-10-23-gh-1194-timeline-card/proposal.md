## Why

The existing Timeline is a page-only technical list. The owner approved a quiet,
minimal-text preview and requested a reusable dashboard card in
[Hub #1194](https://github.com/jimmie-potts/agent-device-hub/issues/1194).

## What Changes

- Share Timeline presentation and authenticated history reads between Home and
  the Timeline page.
- Offer Timeline through the existing Home picker without changing saved layouts.
- Add concise newest-first rows, date/category filters, evidence disclosure and
  explicit refresh. Preserve exact filters behind an advanced disclosure.
- Preserve history truth, passive reads, obsolete-read protection and clear
  loading, empty and unavailable states.

## Capabilities

### New Capabilities

- `timeline-card`: reusable read-only activity card and retained evidence.

### Modified Capabilities

None. Existing history API, Home persistence and device contracts remain intact.

## Impact

Runtime dashboard components, catalog, presentation/read tests and browser checks.
No backend API, collection, retention, external dependency or device-writer change.
