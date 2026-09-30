## Context

See proposal.md for scope. `guide-records/1.0` already provides validated
records, freshness gates, a public projection for Jev and code-computed
dependents. The generated guide already has a fixed organization with collapsed
regions and browsing features. No renderer or composition exists yet.

## Goals / Non-Goals

Define the smallest view language that can express the first goal guides and
the Full guide default, with every claim traceable to records. Do not build a
renderer, provider adapter, request endpoint or state store, and do not change
the existing guide or the guide-records definition.

## Decisions

- Views carry references and presentation choices only. Headings are catalog
  templates, reasons are codes with typed evidence references, and there are no
  free-text or URL fields. Facts, links, dependency lists and readiness are
  resolved from records at render time.
- Use a flat component list with instance IDs and child ID lists, as structured
  model output commonly is. Instance IDs stay stable across refinements, and
  one record can appear in several instances. The validator checks unknown
  children, cycles, second parents, orphans, nesting, depth and sizes.
- Four component kinds (section, sub-guide panel, issue card, dependency list)
  and five groups cover the first slice. Nesting rules cap the depth at three.
  Other kinds wait for a consumer that needs them.
- Separate validation (reject and keep the current view) from resolution
  (recompute each claim at use). An accepted view can age into stale or
  withheld reasons without being rejected. Freshness policy comes from the
  consumer, as in guide-records.
- `question-match` evidence must be a field in Jev's public projection entry.
  Relation, membership and Extends evidence must exist in the records.
  Readiness is always the guide-records ready gate, evaluated at use.
- Suggested order is a labelled presentation choice. Recorded dependencies come
  only from verified relation reasons and code-computed dependency lists.
- Full guide is a constant view with no records binding, rendering the ordinary
  guide. The catalog records the 1.0 region baseline, and a test compares it
  with the committed generated guide. Removing, reordering or re-defaulting a
  baseline region needs a new version; added regions do not.
- Motion is a fixed set of bounded presets. Reduced motion maps each to `none`
  with identical semantic content, and a reference function exposes that
  content for comparison.
- Keep the contract in its own folder with its own digest, importing the
  approved guide-records reference rather than editing it.

## Risks / Trade-offs

- A small catalog limits early compositions → new kinds or groups need a new
  reviewed version, not ad hoc properties.
- The Full guide baseline couples to the generated guide → only removal,
  reordering or default changes of baseline regions fail the check; additions
  pass.
- Validation cannot detect a late response after reset → #548's request
  generation owns that rejection, and the journey records the obligation.
- Later contracts are not approved → traces mark their steps as obligations and
  claim no compatibility with them.

## Migration Plan

Deliver the approved definition and fixtures first. #511 implements rendering
and the Full guide baseline; #512 and #547 produce views; #515 implements
motion. No live migration, installation, provider request or guide publication
occurs here.
