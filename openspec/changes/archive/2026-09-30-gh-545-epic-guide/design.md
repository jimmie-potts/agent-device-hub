## Context

See proposal.md. `guide-records/1.0` supplies evidence, freshness, projection and
dependency rules worth keeping. The first #545 candidate (PR #645 revisions 1
and 2) defined topic-era composed views and was never approved.

## Goals / Non-Goals

Give the browser, the Project views and later Ask one validated dataset and one
catalog, so components never fetch GitHub, parse bodies or re-derive placement.
Do not build the collector, renderer or deployment, change GitHub, or define the
Ask request, decision and state contracts.

## Decisions

- Records 2.0 is a breaking version. Removing `guide` and `subguides` and
  changing the ready gate cannot be a minor revision; 1.0 stays unchanged for
  the current Guide.
- An epic is an issue with the `epic` label; membership is only the native
  parent chain. Placement is the nearest epic ancestor, which does not depend on
  anything above it; unknown, missing or cyclic chains are `unresolved`. The
  collector computes placement once and the validator recomputes it.
- Phase follows #536: an epic's Phase is authoritative and members derive it;
  a differing member value is a visible conflict. Commitment is per item and
  never inherited. A private or unreadable Project yields unknown values, and a
  private Project is never collected into a dataset that may be published.
- Recently done is issues currently closed as completed with `closedAt` in the
  inclusive UTC window from `asOf` minus seven days to `asOf`. The collector
  reads every closure in the window, so a per-repository count is checkable,
  and keeps older closed records only when ancestry or dependencies need them.
  `asOf` is excluded from content identity, like observation times.
- One `issue-card` serves every issue kind; one `epic` component takes epic
  data and child references and either summarizes or composes grouped cards.
  An epic page is exactly one full epic component, and issues inside an epic
  component must belong to that epic. The browser and Ask share these inputs,
  so #511 implements each component once.
- Owner decision, 2026-09-30: a completed closure accepts a prerequisite's own
  scope, and any further required gate is a separate blocking issue. Not-planned,
  duplicate and unknown-reason prerequisites withhold readiness until the owner
  re-links an accepted replacement or removes the link. The live tracker ruled out
  the alternatives: 14 of 76 recently completed Hub issues had every acceptance
  box ticked, and duplicate closures record no native target.
- Owner decision, 2026-09-30: the seven-day closed-issue read is optional
  enrichment, so its failure is a visible gap. Incomplete open-issue inventory,
  failed relationship reads of open issues, missing references into primary
  repositories, invalid records and unsafe projection are fatal to a new release.
- Content identity sorts sets but keeps declared sequences (Phase order,
  Commitment options, ancestry paths); catalogs and views keep every order.
- A release manifest hashes everything but its build time. Clients stay on one
  release, report newer, reload-required or update-required states, call Jev
  only on fully supported releases and discard replies from another release.
  #317 owns promotion order; #547 defines the reply shape.
- Readiness keeps 1.0's evidence gates but needs only Outcome and Acceptance,
  matching the #646 forms; the `idea` label replaces editorial highlights.
- Views carry references and presentation only. Ordinary pages are code-built
  and must satisfy coverage, so they are never truncated; composed views are
  bounded and must carry typed reasons. Both share one component set and one
  resolution, which computes counts from placement, boards from Project values,
  dependency lists from native edges and briefs from planning evidence.
- Guide routes are computed from placement with a fixed grammar; GitHub links
  come only from record URLs.

## Retain, change and defer (from PR #645)

| Asset | Disposition |
| --- | --- |
| Instance IDs, dataset/catalog binding, version checks | Retained. |
| Tree validation: duplicates, cycles, second parents, orphans, nesting, bounds | Retained; bounds now apply to composed views only. |
| Typed reasons with verified evidence and template text | Retained; `guide-member`/`guide-contains` became `epic-member`. |
| Sub-guide panel as a container of cards | Changed into the `epic` component, which composes epic groups of shared cards. |
| Code-computed dependency lists, stale and withheld evidence, re-binding | Retained. |
| GitHub-only link resolver | Retained for GitHub links; Guide routes added. |
| Topic sub-guide panel, topic groups, `idea-extends` | Removed with topics and Extends. |
| Full guide baseline and its test against the generated HTML | Removed; no old-layout parity. |
| Motion presets, reduced-motion model, emphasis | Deferred to later composed interactions. |

## Risks / Trade-offs

- The `epic` label is not created yet → #646 documents it and #655 applies it;
  until then fixtures prove behavior and every live issue lands on Not in an
  epic, which stays browsable.
- Project values are unknown until #540 makes the Project public and readable →
  boards and Phase show Unknown, never empty.
- Coverage makes ordinary pages long for large epics → compact rows, a bounded
  initial set, Show more and shareable filters belong to #511; the contract
  forbids truncation, not grouping, and exposes section totals.
- Native links carry prerequisite acceptance → owners must file further gates
  as blocking issues and re-link replacements; nothing is inferred from prose.
- The seven-day window depends on `asOf` → a closure ages out of Recently done
  without other edits, and the per-repository count changes with it.
- The Ask contracts still describe the old design → reconciliation happens
  before Ask pickup; nothing here approves them.

## Migration Plan

Approve and merge this definition. #511 implements the collector and browser
against it, #540 supplies Project values, #317 and #654 publish and check the
builds, and #656 retires the old Guide and, later, `guide-records/1.0`.
