# Guide components and composed views contract

Version `guide-views/1.0`. Owning work:
[Hub #545](https://github.com/jimmie-potts/agent-device-hub/issues/545).
The JSON schema, catalog, this dictionary, the offline reference and the
fixtures are one definition. Approval is recorded against their exact digest in
the delivery PR; the version string alone is not proof of approval. No
production consumer imports these files in this delivery.

This contract consumes the approved [guide records](../README.md) definition
`guide-records/1.0` (content SHA-256
`f2eea2bf8a737bbe3b5542ffbf2c04961e4564dd8fe27326464726f44a00e34d`, approved
under [#543](https://github.com/jimmie-potts/agent-device-hub/issues/543)). It
reuses that definition's validator, evidence gates, public projection and
dependent computation. It does not change them, and it lives in its own folder
so their approved bytes stay unchanged.

## Boundary

A view says which existing records appear, how they are grouped and presented,
and why each was selected. It never carries issue facts, prose, URLs, counts,
dependency lists, readiness claims or free text. Application code resolves every
displayed fact from the validated guide records at render time and computes
every graph and readiness claim itself.

There are two view shapes:

- **Full guide** is the constant `{"schemaVersion": "guide-views/1.0",
  "layout": "full-guide"}`. It is the default on every fresh open and the
  target of the Full guide action. It needs no records, catalog selection,
  question or provider call, and it renders the ordinary guide unchanged.
- **Composed view** is a bounded tree of catalog components that references one
  guide-records dataset and one catalog. It exists only after the owner submits
  a question, and code validates it before anything renders.

The canonical machine shape is [guide-views.schema.json](guide-views.schema.json).
The supported components, groups, reasons, layouts, motion presets, bounds and
Full guide inventory are in [catalog.json](catalog.json). [reference.mjs](reference.mjs)
is an offline, side-effect-free reference for validation and resolution. It is
not a renderer, provider adapter or state store.

## Field ownership dictionary

Every property is required unless marked optional. Objects are closed; extra
properties, unknown enum values and unsupported versions are rejected.

| Field | Producer | Meaning and validation |
| --- | --- | --- |
| `schemaVersion` | This definition | Exactly `guide-views/1.0`. Any other value is `unsupported-version`. |
| `layout` | Full guide: code. Composed: application from the validated decision | `full-guide`, `stack` or `board`, as the catalog describes. Layout never changes reading order, which is root order then child order. |
| `recordsVersion` | Application | Exactly `guide-records/1.0` and equal to the dataset's `schemaVersion`. |
| `datasetId` | Application: the dataset the decision was made against, or the dataset a later re-bind validated | Must equal the current validated dataset's `datasetId`, or the view is `dataset-mismatch`. It binds content, not freshness; freshness is checked at resolution. See "Refresh and re-binding". |
| `catalogId` | Application, from `catalogIdentity(catalog)` | SHA-256 of the canonical catalog JSON (object keys sorted, arrays kept in authored order). Must equal the renderer's catalog, or the view is `catalog-mismatch`. |
| `transition` | Decision, validated by the application | Motion into this view: `none`, `assemble` or `rearrange`. Presentation only; excluded from the view's facts and actions. |
| `root` | Decision | 1-6 instance IDs of `section` components, in reading order. A group appears at most once. |
| `components[]` | Decision; the application assigns instance IDs | 1-48 components. Each has an `id` and a `kind` with that kind's properties below. |
| `components[].id` | Application | Stable component-instance ID, `^[a-z][a-z0-9-]{0,31}$`, unique in the view. It is opaque, never parsed as a record ID, and a record shown twice has two instance IDs. #548 decides which instance IDs survive a refinement. |
| `section.group` | Decision | One catalog group. The group fixes the heading text (a catalog template) and the allowed child kinds. `candidates` ("Possible next work") children need a `ready-candidate` reason, which does not by itself establish readiness; `ideas` children must be Guide ideas. |
| `section.sequence` | Decision | `none`, or `suggested`: children are numbered as a suggested reading or work order, labelled as not a recorded dependency. |
| `section.disclosure`, `subguide-panel.disclosure` | Decision | Initial `open` or `collapsed` state. The reader can toggle it; it hides nothing from search, print or assistive technology. |
| `section.children`, `subguide-panel.children` | Decision | Instance IDs, at most 12, in order. Sections take 1-12; a panel may take none. |
| `subguide-panel.subguide` | Decision | A `subguides[].id` in the dataset. The panel shows that sub-guide's authored title, outcome, next step, owner and date. Its children must be members of that sub-guide. |
| `issue-card.record`, `dependency-list.record` | Decision | An `issues[].id` in the dataset (`owner/repo#number`). |
| `issue-card.density` | Decision | `compact` or `standard` presentation of the same facts and actions. |
| `emphasis` | Decision | `none` or `highlight` on cards and panels. A highlight is a static visual state; with motion allowed it plays the `emphasize` preset once. |
| `dependency-list.direction`, `scope` | Decision | `prerequisites` or `dependents`, `direct` or `transitive`. Code computes the list; the view carries no edges. |
| `reasons[]` | Decision for relevance; application for code-derived reasons | 1-3 reasons with distinct codes on each card and panel. Each reason has a `code` and typed `evidence` references, checked below. |

`requiredData` in the catalog names the record fields each component displays.
The renderer reads them from the referenced record at render time. An
unavailable value is shown as a visible gap with its source, following
guide-records rules; the view never supplies a replacement.

## Selection reasons

Reasons explain why a card or panel is present. The display text is the catalog
template filled with references; there is no model-written explanation.

| Code | Components | Evidence | Validation | Resolution |
| --- | --- | --- | --- | --- |
| `question-match` | card, panel | 1-4 `{field}` | Each field must appear in that record's public projection entry, meaning Jev actually received it. | `supported` relevance only. It never implies readiness or completeness. |
| `guide-member` | card | 1 `{subguide}` | The sub-guide exists and lists the issue. | `supported` authored membership, dated by the sub-guide. |
| `guide-contains` | panel | 1-4 `{relation: "contains", record}` | The sub-guide lists each issue. | `supported` authored membership. |
| `recorded-relation` | card | 1-4 `{relation, record}` with `blocks`, `blocked-by`, `parent-of` or `child-of` | The other issue exists and the native edge is observed in the owning collection: `blocks` in the other issue's `blockedBy`, `blocked-by` in this issue's `blockedBy`, `parent-of` in `children`, `child-of` in `parent`. | `supported` when the owning collection is fresh under the consumer's policy; otherwise `stale` with a source-linked reason. |
| `idea-extends` | card | 1-4 `{relation: "extends", record}` | The card is a Guide idea whose `Extends` lists the record. | `supported`; never a prerequisite. |
| `ready-candidate` | card | none | Allowed on any card; required in `candidates`. | Code runs the guide-records `ready` gate at use. `withheld` shows "Readiness not established" and lists every failed gate with its source. The card stays in its section. |

Observed relation edges are shown even when their collection is incomplete, as
guide-records allows. A missing edge is never shown as "no blockers". Validation
rejects a reason whose evidence does not exist in the records. Resolution
withholds or dates a reason whose evidence exists but is not current.

## Recorded order and suggested order

Child order in a section is presentation order. With `sequence: suggested` it is
numbered and labelled "Suggested reading order, not a recorded dependency." Only
two things show recorded dependencies: `recorded-relation` reasons, which the
validator checks against native edges, and `dependency-list` components, which
code computes:

- Prerequisites, direct: the issue's native `blockedBy` IDs. The list is complete
  only when that collection is fresh and complete under the policy.
- Prerequisites, transitive: observed `blockedBy` edges through open issues,
  stopping at closed ones. The list is complete only when the guide-records
  `prerequisites` gate allows it.
- Dependents: the guide-records `dependents` computation. The list is unknown
  (`ids: null`) unless the primary inventory and every open issue's graph are
  fresh and complete, or when the record is closed or outside the primary
  repositories.

An unknown list has `ids: null` and `complete: false`. It is never shown as empty.

## Validation before rendering

`validateView(view, {dataset, catalog})` stops at the first failure and rejects
with its stable code. Version, schema and binding checks run first, then the
tree walk, then record and evidence checks. #546 maps these codes to user-facing
outcomes.

| Code | Condition |
| --- | --- |
| `unsupported-version` | `schemaVersion` is not `guide-views/1.0`. |
| `schema` | Shape, enum, pattern or size violation, including unknown kinds, reasons, motion presets, extra properties and URLs or free text in any field. |
| `catalog-mismatch` | `catalogId` differs from the renderer's catalog, or the catalog is another version. |
| `records-mismatch`, `records-invalid` | The dataset is another records version or fails guide-records validation. |
| `dataset-mismatch` | `datasetId` differs from the current validated dataset. |
| `size-exceeded` | More than the catalog's component, root or child bounds. |
| `duplicate-instance` | Two components share an `id`. |
| `unknown-component` | A root or child ID has no component. |
| `cycle` | A component is reachable from itself. |
| `multiple-parents` | A component is listed more than once in the tree. |
| `depth-exceeded` | A component is deeper than `maxDepth` (3: section, panel, card). |
| `nesting-not-allowed` | A kind appears under a parent or group the catalog does not allow. |
| `duplicate-sibling` | The same record, sub-guide or group appears twice under one parent. The same record under different parents is allowed. |
| `orphan` | A component is not reachable from `root`. |
| `group-requirement` | A `candidates` card lacks `ready-candidate`, or an `ideas` card is not a Guide idea. |
| `unknown-record` | A referenced issue or sub-guide is not in the dataset. |
| `membership` | A card inside a panel is not a member of that sub-guide. |
| `duplicate-reason`, `reason-not-allowed` | A repeated reason code, or a code the component does not support. |
| `evidence-not-public`, `evidence-unverified` | Question-match evidence Jev never received, or a membership, relation or Extends claim the records do not contain. |

A rejected view is never partly rendered. The current view or Full guide stays
in place. Validation success is necessary but not sufficient for acceptance:
#548 still decides whether the response belongs to the current request.

## Resolution and links

`resolveView(view, {dataset, policy, reducedMotion})` validates again, then
returns an ordered model: each node's instance ID, kind, parent, depth, position,
disclosure, record reference, template heading, computed dependency list,
resolved reasons, link and available actions. The consumer supplies the
guide-records freshness policy (`asOf` and positive `maxAgeMs`); a composed view
cannot choose one. Resolution runs again as time passes and after every
refresh, so an accepted view can age into `stale` or `withheld` reasons.

## Refresh and re-binding

A refresh that only renews observation times keeps the same `datasetId`, and
the view on screen simply resolves again. A refresh that changes any record
content, anywhere in the three repositories, produces a new `datasetId`. The
view on screen is then bound to replaced records and would fail as
`dataset-mismatch`.

`rebindView(view, {dataset, catalog})` handles that case for the view already
on screen. It copies the view with the new `datasetId` and runs the complete
validation against the new records. If that passes, the copy replaces the view
and resolves from current facts. If it fails, it rejects with the same code
validation would give (for example `unknown-record`, `membership` or
`evidence-not-public`). #548 then keeps the last rendered view visible, marked
out of date with that code, and offers Full guide or a new question. It never
shows that view as current.

Re-binding never changes the catalog, records version, components or reasons.
It applies only to a view the owner already has. A provider response that
arrives bound to replaced records is still rejected, as guide-records requires,
because it was chosen from content the owner no longer has. A question match
cites a field, not its text: after a re-bind the card shows the current text,
and the match remains a relevance hint.

Views contain no URLs. The only links are a card's issue `url` and a panel's
authored `source`, and only when they parse as `https://github.com/` pages with
no credentials. Anything else, including an API URL, renders without a link.

## Motion and reduced motion

Presets are fixed in the catalog: `assemble` and `rearrange` for view
transitions, `emphasize` for highlighted components, and `acknowledge`, a single
character acknowledgment the renderer plays once when a composed view is
accepted. Each preset runs once, animates only opacity and transform, and fits
within its `maxDurationMs`. The whole view settles within `settleMs` (1200 ms)
and then stays still while the owner reads. No inference or data read happens
per frame. #515 supplies the visual treatment within these bounds.

With reduced motion, every preset becomes `none` and the final state appears
immediately. The facts, reasons, order, disclosure, emphasis, focus targets and
actions are identical; `semanticContent` removes only the motion fields, and the
fixtures check that equality.

## Full guide

The Full guide is the ordinary generated guide, not a composed subset. The
catalog records the 1.0 baseline that any catalog-based renderer (#511) must
reproduce, in this order:

| Region | Default |
| --- | --- |
| `work-overview` opening lists: Current work, Newly added, Open defects, Useful next steps, Blockers and decisions, Later | Always shown; its "more" lists start collapsed |
| `timeline`, `direction`, `ideas` | Collapsed |
| One `guide` section per topic, in `guide_paths.TOPICS` order | Open; the PC lighting track and closed-story evidence start collapsed |
| `local-acceptance` completed milestones | Collapsed |
| `architecture` diagrams | Open; future scenarios start collapsed |

These features stay available: skip link, sidebar navigation, theme toggle,
GitHub status refresh, search with clear and empty state, Expand all, Collapse
all, print (which expands everything and restores the prior state) and task
briefs, with modified clicks opening GitHub. A check compares this baseline with
the committed generated guide. Removing, reordering or changing the default of a
baseline region needs a new version of this contract. A region the guide adds
later is part of the Full guide without a contract change.

Opening the guide, browsing, searching, filtering, printing and source refreshes
never request a composition. The Full guide action returns to this view, clears
the composed selection and layout, and invalidates pending responses (#548
defines the invalidation).

## Producers and consumers

| Party | Responsibility |
| --- | --- |
| This definition | Catalog, schema, validation and resolution rules, rejection codes and the Full guide baseline. |
| Jev decision adapter (#547) | Sends Jev the catalog's kinds, groups, reason codes and presentation options with the guide-records public projection. Converts a typed decision into a composed view, keeping `question-match` evidence to fields Jev received. Adds no facts. |
| Application (#512) | Assigns instance IDs, adds code-derived reasons and dependency lists, binds `datasetId` and `catalogId`, and validates before handing the view to the renderer. |
| Request and outcome contracts (#544, #546) | Carry the question, timeouts and failures. A rejection code becomes a visible outcome; the current view is kept. |
| View state (#548) | Holds the current view, request generation, pins and undo. It decides which instance IDs survive a refinement, and it rejects late responses after a reset. |
| Renderer (#511) | Implements each component kind and the Full guide baseline, resolves facts from records, resolves again on every refresh and re-binds the current view after a content change. |
| Visual treatment (#515) | Implements the motion presets within their bounds, with the reduced-motion equivalent. |

## Compatibility, fixtures and approval

`fixtures/composed.json` is a valid composed view over the guide-records
`fixtures/valid.json` dataset: a candidate card with a suggested order, a
sub-guide panel with a member card and a recorded relation, and a collapsed
prerequisite list. `fixtures/cases.json` applies named changes to that view or
its records and records the expected rejection code or resolved state. The
[journey](journey.md) traces the owner's path across the other contracts. Run
`node --test docs/work-guide/contracts/guide-views/views.test.mjs` under Node 24
after `npm ci`.

Version support is exact. Changes to a kind, property, group, reason, evidence
rule, bound, motion preset, rejection code or the Full guide baseline need a new
reviewed version and renewed approval. The catalog identity changes with any
catalog byte that is meaningful to JSON. Keep old versions while an accepted
consumer needs them.

Before adoption, the delivery PR records: issue, canonical artifact paths,
version, candidate commit, SHA-256 content digest, approver, explicit approval
statement, timestamp and a durable owner-evidence link. An agent-authored
statement under shared credentials cannot supply the approval. The bundle digest
covers this folder except the test runner, plus the normative OpenSpec
delta/main specification. `digest.mjs` normalizes the ADDED Requirements
heading, the generated main-spec title and terminal blank lines for archival.
Verify the same digest in merged source before closing the issue.

Recompute it with Node 24 from the repository root:

```bash
node docs/work-guide/contracts/guide-views/digest.mjs openspec/specs/guide-views/spec.md
```

Until the OpenSpec change is archived, pass its delta spec instead.
