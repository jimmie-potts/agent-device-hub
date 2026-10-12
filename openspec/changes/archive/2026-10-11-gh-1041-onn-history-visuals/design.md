## Context

See proposal.md for the outcome. The ONN browser contribution currently owns one
controls page. The owner exposes `onn-history-state/2.0` sync and authenticated
`history`/`history-detail` content references. The shell owns credentials,
connection lifetime and tracked controls. Design is included because asynchronous
reads and freshness affect truthful presentation of private retained content.

## Goals / Non-Goals

**Goals:** Consume those interfaces in the existing page, preserve control
behavior and show bounded history with source evidence and local dates.

**Non-Goals:** Changing collection, retention, device transport or shared SDK
contracts; creating totals, completion, charts, recommendations or ad features.

## Decisions

1. Extend the module's existing page with current content and history sections.
   Reuse the shell's components and styling. A separate dashboard registration
   or standalone app would duplicate navigation and authenticated context.
2. Subscribe to the declared history-state family. Validate browser documents,
   respect owner revisions and connection lifetime, and apply the owner's stale
   bound locally if updates stop. An accepted empty current list clears content.
   A browser timer changes age labels only; it never polls or extrapolates position.
3. Use explicit submitted app/date/title filters and the exact returned cursor
   with its original filters/limit. Keep one bounded result page and detail page
   in memory. Latest-read/lifetime guards retire delayed responses. Automatic
   history polling or client aggregation would obscure cutoff and coverage.
4. Calendar controls use the browser's local zone, inclusive From and inclusive
   Through dates translated to an exclusive next calendar midnight. Construct
   calendar dates rather than adding twenty-four hours. State these boundaries
   in the form; timestamps carry local formatting. No reporting zone or watched
   time is invented.
5. Render metadata as React text and show available fields, identity confidence,
   omissions and source position/duration. YouTube says selected-title observed.
   No URLs become links, images or external requests; drafts/results remain in
   page memory and never become browser storage or diagnostics.
6. The module's existing catalog scenario declares its optional browser capture
   and timeout. The shared disposable runner invokes that declaration after the
   scenario passes, without naming the module. CI and independent Acceptance use
   the same capture; in-memory scenarios do not load or run browser code.

## Risks / Trade-offs

- Lost sync or changed owner → retire freshness and discard late replies; keep
  last-observed labels separate from current evidence.
- Empty bounded filter window → preserve continuation so the reader can reach
  later evidence; show that an empty page is not proof of an empty archive.
- Partial or capped metadata → explicit unknowns and omission/coverage text;
  inspect contributing observations without recovering unobserved fields.
- Current collector loss during an older cutoff read → show live storage health
  separately from retained cutoff-bound gaps, matching the owner contract.
- Long private strings → wrap within the layout and render only as text; use
  synthetic fixtures and keep production observations out of GitHub evidence.

## Migration Plan

No backend schema or data migration is needed. Source is delivered through the
reviewed module frontend build; #1044 owns the qualified runtime upgrade and
fresh approved installed/physical sequence. A source revert restores the prior
controls page while retaining the private backend observations.
