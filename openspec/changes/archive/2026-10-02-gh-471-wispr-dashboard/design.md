## Context

See proposal.md for motivation. Existing authenticated Hub routes already return
validated aggregate envelopes. Dashboard routes/widgets share one React shell;
most old pages remain mounted. Wispr text needs a stricter lifecycle. Design is
required because this change crosses navigation, auth and sensitive async reads.

## Goals / Non-Goals

Keep one browser reader, existing permission checks and producer computations.
No database, collector, new API, chart library, persistent client cache or device
operation. The reduced presentation scope and future triggers belong to #471.

## Decisions

- Add a focused Wispr module and route; preserve filters in the shell but mount
  the text-bearing page only while visible. This avoids hidden text and leaves
  existing component-page focus behavior intact. The numeric home reader stays
  independent and fetches no language.
- Read status, then the existing numeric JSON export (which includes totals,
  daily groups and apps), plus the three language corpora when allowed. Recheck
  status before committing results. Require identical source/namespace/generation/
  revision and sharing permission; abort retired selections and ignore late
  completion. This uses existing contracts instead of adding a combined endpoint.
- Bound requests through the existing five-second Api client and one polling
  operation at a time. Clear text on read failure; only same-selection numeric
  last-good data can survive with an explicit error and original collection age.
  Source retirement discards both. Context grant refresh must not wait for the
  unrelated monitor request to succeed.
- Numeric APIs reject dates outside captured bounds. Intersect the preset with
  captured bounds and label the actual coverage; no intersection means no numeric
  observation, not an invented zero. Language uses the original preset. Expired
  producer presets are labelled by their actual dates and cannot masquerade as
  today's home totals. Numeric export follows the same selected intersection.
- Render semantic tables, metric facts and local SVG trends using existing tokens.
  Missing calendar days break line segments. The table is the accessible/touch
  value alternative; no separate hover-only interaction or chart framework.

## Risks / Trade-offs

- Polling cannot detect opt-out before a server response → five-second refresh,
  immediate retirement on an observed denial, final status check, abort/generation
  guards, and tests with delayed language responses. No persistent text cache.
- Collection can change between route responses → reject mismatched snapshots and
  retry on the next bounded poll, without mixing revisions.
- Sparse dates do not establish inactivity → show only captured values and explicit
  gaps, with global coverage beside filtered totals.
- Private strings might be HTML-like → React text nodes only; synthetic canaries
  test escaping, opt-out and late-response retirement.

## Migration Plan

Source-only addition to the existing bundled dashboard. Existing configurations
without Wispr remain unchanged. Revert this source PR to remove the UI without
changing collector history or Hub APIs. Installation and personal data remain #472.
