# Epic Guide records and components contract

Versions `guide-records/2.0` and `guide-views/1.0`. Owning work:
[Hub #545](https://github.com/jimmie-potts/agent-device-hub/issues/545), under
[epic #509](https://github.com/jimmie-potts/agent-device-hub/issues/509). The
schemas, catalog, this dictionary, the offline references and the fixtures in
this folder are one definition with one approval. Approval is recorded against
the bundle digest in the delivery PR; a version string alone proves nothing. No
production consumer imports these files in this delivery.

The public epic browser (#511, #540, #317) and the later local Ask the Guide use
this one dataset and one component catalog. GitHub issues, their native
relationships and the portfolio Project's Phase and Commitment fields own every
fact. Nothing here is hand-maintained Guide content.

## Relationship to guide-records/1.0

The approved [guide-records/1.0](../README.md) (SHA-256
`f2eea2bf8a737bbe3b5542ffbf2c04961e4564dd8fe27326464726f44a00e34d`,
[approval](https://github.com/jimmie-potts/agent-device-hub/issues/543#issuecomment-5894188626))
stays byte-for-byte unchanged while the current Guide or any other consumer uses
it. Its approval does not cover this definition.

Records 2.0 is a breaking version: it removes the `guide` object and topic
`subguides`, adds epic placement and Project values, and changes the ready gate.
A 1.0 dataset is rejected as `unsupported schemaVersion`, and a 2.0 dataset is
never relabelled as 1.0. Everything else keeps 1.0's meaning: identity,
repositories and inventory receipts, observations and freshness, story sections
and their parser, native `parent`, `children` and `blockedBy`, `planning`,
`publicFields`, the public projection, dependents and content identity.

| Change from 1.0 | Reason |
| --- | --- |
| `guide` (Topic, Note, Workaround, Highlight, Extends) removed | Topics are retired; issue bodies own their text. A legacy `## Guide` section stays in the body as inert text until #656 retires it. |
| `subguides` removed | Epics replace topic and track sub-guides. |
| `placement` added per issue | One canonical primary placement from the native parent chain and the explicit epic label. |
| `project` added per issue and for the dataset | Phase and Commitment are owner planning values with their own source and unknown states. |
| Ready gate needs Outcome and Acceptance, not all five sections | The new intake forms (#646) make the other three conditional. Guide placement and editorial highlights no longer gate readiness; the `idea` label does. |
| `publicFields` drops `guide.*` paths | Those fields no longer exist. |

## Records 2.0 field dictionary

The canonical shape is [records.schema.json](records.schema.json);
[records.mjs](records.mjs) is the offline reference. Fields not listed below keep
their 1.0 dictionary entries unchanged.

| Field | Source and owner | Meaning and unavailable behavior |
| --- | --- | --- |
| `schemaVersion` | This definition | Exactly `guide-records/2.0`. |
| `project.source` | Collector configuration (#540) | The named Project, or null when none is configured. |
| `project.public` | Collector, from a verified visibility read (#540) | `true` only after the Project's public visibility is verified. While false, the collector does not read the Project: its evidence is not fresh, and every issue's Project values are unknown. Private Project content cannot enter a dataset, which may itself be published. |
| `project.evidence` | Projects API read | Observation of all Project items, with the 1.0 observation rules. Failed, denied, partial or stale reads are distinct states; none of them means an empty portfolio. |
| `project.phases` | Project Phase field options, in owner order | Allowed Phase names. The order is owner intent for display, never a dependency or a date. |
| `project.commitments` | Project Commitment field options | Subset of Now, Next, Later and Ideas. |
| `issues[].placement` | Computed by the collector from native parents and labels; checked by the validator | See "Epics and placement". Consumers read it and never recompute it. |
| `issues[].project.member` | Project items | Whether the issue is a Project item; null when the Project was not readable. |
| `issues[].project.phase.recorded` | The item's own Phase value | Null when blank or not a member. |
| `issues[].project.phase.{state,value,from}` | Computed from `recorded` and the nearest epic | See "Phase and Commitment". |
| `issues[].project.commitment` | The item's own Commitment value | `selected` with a value, `unselected` (blank or not a member), or `unknown`. Never inherited. Blank is not Ideas. |

The collector recomputes placement and Project states after every source change,
using the reference functions `placementOf` and `projectOf` or an equivalent
that matches the fixtures. Validation fails with `placement mismatch` or
`project mismatch` when a supplied value disagrees with the recomputation, so no
component re-derives these values or parses issue bodies.

## Epics and placement

An issue is an **epic** only when it carries the `epic` label, the convention #646
documents for intake. A parent without that label is a grouping, not an epic.
Membership comes only from native parent/sub-issue links, which may cross
repositories.

`placementOf` walks the native parent chain from the issue upward:

| Walk result | `state` | `epic` | `path` |
| --- | --- | --- | --- |
| Reaches an ancestor with the `epic` label | `epic` | Nearest such ancestor | Non-epic ancestors between that epic and the issue, epic side first |
| Ends with no parent, and the issue is an epic | `root` | null | Non-epic ancestors above it, if any |
| Ends with no parent, and the issue is not an epic | `standalone` | null | Non-epic ancestors above it, if any |
| A parent list is unknown (`ids: null`) | `unresolved`, reason `parent-unknown` | null | Ancestors read so far |
| A parent is not in the dataset | `unresolved`, reason `ancestor-missing` | null | Ancestors read so far |
| The chain revisits an issue | `unresolved`, reason `parent-cycle` | null | Ancestors read so far |

Placement uses observed parent IDs even when their evidence is stale, as
browsing does in 1.0. Only an unknown or unusable chain is unresolved, and the
nearest epic does not depend on anything above it. Deep ancestry is kept whole
in `path`; view depth bounds never shorten it.

Every open issue has exactly one **primary page** (`primaryPage`): its nearest
epic's page for `epic`, its own page for `root`, and Not in an epic for
`standalone` and `unresolved`. A nested epic's primary page is its containing
epic, where it appears as a sub-epic; it also has its own page. Closed issues
keep their placement for Recently done but have no primary page.

## Phase and Commitment

These are owner planning values from the Project, following the accepted
[#536 rules](https://github.com/jimmie-potts/agent-device-hub/issues/536): an
epic's Phase is authoritative, and its members derive Phase through the native
parent chain.

| Case | `phase.state` | `phase.value` |
| --- | --- | --- |
| Project not readable, or membership unknown | `unknown` | null |
| An epic, or a `root` or `standalone` issue, with its own Phase | `assigned` | Its own value |
| The same, with no Phase | `unassigned` | null |
| Inside an epic, no own Phase, epic has a Phase | `inherited` | The epic's value |
| Inside an epic, own Phase equals the epic's | `inherited` | That value |
| Inside an epic, neither has a Phase | `unassigned` | null |
| Inside an epic, own Phase differs from the epic's, or the epic has none | `conflict` | null; `recorded` keeps the item's value |
| Unresolved placement, or the epic's Phase is unknown or in conflict | `unknown` | null |

`from` names the epic the value derives from. A conflict is shown for the owner
to resolve; nothing overwrites either value. Phase order, Phase assignment and
Commitment never create blockers, affect readiness or select work. Readiness
never selects a Commitment.

## Operations and readiness

`eligibility` keeps the 1.0 operations and evidence rules (browse, discover,
prerequisites, ready) with these ready-gate changes: the issue must be open,
carry exactly `status:ready` among the workflow labels, have no `blocked`,
`deferred` or `idea` label, have present Outcome and Acceptance sections with
non-placeholder acceptance, and have fresh facts and a fresh, complete, closed
prerequisite chain. Missing Implementation, Protections or Deferrals sections do
not withhold readiness. Ordinary browsing never needs any of this evidence.

The Jev projection is 1.0's projection over issues only, with the same
320-character literal excerpts. It never includes bodies, Project values,
placement, credentials or other unselected metadata.

## Views 1.0

A view is a bounded tree of catalog components for one page. It carries record
references and presentation choices only: no issue text, URLs, routes, counts,
dependency lists, readiness claims or free text. The canonical shape is
[views.schema.json](views.schema.json), the vocabulary is
[catalog.json](catalog.json), and [views.mjs](views.mjs) is the offline
reference for validation and resolution.

| Field | Producer | Meaning and validation |
| --- | --- | --- |
| `schemaVersion`, `recordsVersion` | This definition | Exactly `guide-views/1.0` and `guide-records/2.0`. |
| `datasetId` | View producer | The validated dataset the view was built against; otherwise `dataset-mismatch`. |
| `catalogId` | View producer, from `catalogIdentity` | SHA-256 of the canonical catalog (keys sorted, arrays in authored order); otherwise `catalog-mismatch`. |
| `origin` | View producer | `ordinary` for code-built browser pages; `composed` for Ask answers. Each page kind allows one origin. |
| `page.kind`, `page.record` | View producer | `home`, `epic` (record must carry the `epic` label), `not-in-epic`, `all`, `portfolio`, `issue` (a task brief) or `answer` (composed). |
| `layout` | View producer | `stack` or `columns`; reading order is always root order, then child order. |
| `root`, `components[].children` | View producer | Instance IDs in order. |
| `components[].id` | View producer | Stable instance ID, `^[a-z][a-z0-9-]{0,31}$`, unique in the view and never parsed as a record ID. One record shown twice has two instance IDs. |
| `section.group`, `section.record` | View producer | A catalog group allowed on the page. The group fixes the template heading, the allowed child kinds and a record predicate. `parent-group` names the grouping issue in `record`; others leave it null. |
| `section.sequence`, `section.disclosure` | View producer | `suggested` numbers children as "Suggested reading order, not a recorded dependency"; `disclosure` is the initial open or collapsed state. |
| `issue-card.presentation`, `issue-card.primary` | View producer | `card` or `row` presentation of the same facts and actions. `primary` marks the issue's canonical placement; see coverage. |
| `epic-summary.record` | View producer | An epic; its counts are computed at resolution. |
| `dependency-list` | View producer | `prerequisites` or `dependents`, `direct` or `transitive`; code computes the list. |
| `board.by` | View producer | `commitment`, `phase` or `workflow`; code places each child in a column. |
| `task-brief.record` | View producer | Only as the root of an `issue` page for the same record. |
| `reasons[]` | View producer | 1-3 reasons with distinct codes. Required on every card and summary in a composed view; optional on ordinary pages. |

### Pages, groups and coverage

Each page kind lists its allowed groups in the catalog. Each group's predicate
must hold for every card or summary in it, checked against the records (for
example `active` for In progress, `closed` for Recently done, `descendant` for a
parent group, `not-in-epic` for Not in an epic). `up-next` also requires a
`ready-candidate` reason, which resolution evaluates.

Coverage makes ordinary pages complete, never truncated:

- **Epic and Not in an epic pages** (`primary` coverage) list every open issue
  whose primary page they are exactly once, as a primary card or, for a nested
  epic, as a sub-epic summary. A primary card for any other issue is
  `coverage`.
- **All issues** (`complete` coverage) lists every open issue exactly once, with
  no primary cards.
- **Other pages** may repeat cards but may not mark any as primary. Composed
  views never define placement.

Unique counts come from placement (`epicCounts`), so repeated cards never change
them.

### Reasons

Reasons explain a card's presence with a catalog template; there is no
model-written explanation.

| Code | Components | Evidence | Validation | Resolution |
| --- | --- | --- | --- | --- |
| `question-match` | card, epic summary | 1-4 `{field}` | Each field is in the record's Jev projection entry. | `supported` relevance only; never readiness. |
| `epic-member` | card | 1 `{epic}` | The record's nearest epic is that epic. | `supported`. |
| `recorded-relation` | card | 1-4 `{relation, record}`: `blocks`, `blocked-by`, `parent-of`, `child-of` | The native edge is observed in the owning collection. | `supported` when that collection is fresh under the policy; otherwise `stale` with a source. |
| `ready-candidate` | card | none | Required in Up next. | The records ready gate at use; `withheld` shows "Readiness not established" with every failed gate. |

### Bounds

Composed views are limited to 48 components, 6 root components, 12 children per
component, 3 reasons and 4 evidence references. Ordinary pages have no count
bound, because coverage requires them to list everything. All views are at most
three levels deep (section, board, card); ancestry beyond that stays in each
card's `path`.

### Resolution, routes and links

`resolveView(view, {dataset, policy})` revalidates, then returns an ordered
model. Each node has its instance ID, kind, parent, depth, position and record
reference. Cards and summaries add the GitHub link, Guide route, workflow
labels, state and closure reason, placement, Phase, Commitment, resolved reasons
and actions; summaries add counts. Dependency lists add computed IDs and
completeness, boards add their columns, and briefs add their commands and
recommendation state. The consumer supplies the freshness policy, as in 1.0.

Links come only from records, never from a view or a model:

- the GitHub link is the record's `url`, accepted only as an `https://github.com/`
  page without credentials;
- the Guide route is computed from placement with the catalog's route grammar
  (`epics/{owner}/{repo}/{number}/`, `not-in-epic/`, `all/`, `portfolio/`, and
  `{page}#{owner}/{repo}/{number}` for an issue).

The model contains references, not text. Renderers show issue text literally;
`literalText` is the minimum escaping, and a hostile title stays inert.

Boards list the Project's options in owner order, then `Unselected` and
`Unknown` for Commitment; `Unassigned`, `Conflict` and `Unknown` for Phase; and
`Closed` and `No single status` for workflow. An unreadable Project places every
item in `Unknown`, never in an empty board.

Task briefs always offer Explain, Plan, Implement and Review. A single current
execution recommendation adds its guidance. A stale, missing, unsupported or
duplicated recommendation leaves the generic commands in place and says so.
Copying a command never runs it.

### Refresh and re-binding

A fetch-only refresh keeps `datasetId`, and the page resolves again. A content
refresh produces a new `datasetId`. The browser rebuilds ordinary pages from the
new records. For a composed view on screen, `rebindView` copies it with the new
`datasetId` and runs complete validation against the new records. On success it
resolves from current facts. On failure the view stays visible, marked out of
date with the rejection code, and is never shown as current. A provider response
bound to replaced records is still rejected.

### Rejection codes

`validateView` stops at the first failure: version and schema, then binding,
then page rules and the tree walk, then records and evidence, then coverage.

| Code | Condition |
| --- | --- |
| `unsupported-version`, `schema` | Wrong version, shape, enum, pattern or property, including URLs, free text and unknown kinds or reasons. |
| `catalog-mismatch`, `records-mismatch`, `records-invalid`, `dataset-mismatch` | The view is bound to another catalog, records version or dataset, or the records fail validation. |
| `page-not-allowed` | The origin, page record or a section group does not fit the page kind. |
| `size-exceeded`, `depth-exceeded` | A composed bound or the depth bound is exceeded. |
| `duplicate-instance`, `unknown-component`, `cycle`, `multiple-parents`, `orphan` | Broken tree identity or structure. |
| `nesting-not-allowed`, `duplicate-sibling` | A kind under a parent or group that does not allow it, or the same record twice under one parent. |
| `unknown-record`, `group-requirement` | A missing record, or a record that fails its group's predicate or required reason. |
| `reason-required`, `reason-not-allowed`, `duplicate-reason` | Reason rules for the component and origin. |
| `evidence-not-public`, `evidence-unverified` | Evidence Jev never received, or a membership or relation the records do not contain. |
| `coverage` | An ordinary page omits or repeats a placed issue, or a page claims a placement it does not own. |

A rejected view is never partly rendered.

## Producers and consumers

| Party | Responsibility |
| --- | --- |
| This definition | Both schemas, the catalog, placement, Project and readiness rules, reasons, coverage, routes and rejection codes. |
| Collector and browser (#511) | Collects complete records, computes placement and Project states, audits the live inventory, builds ordinary pages that satisfy coverage, renders every component literally and runs the browser checks. |
| Project access (#540) | Verifies Project visibility and a least-privilege read path, and supplies `project.*`. Until then, Project values stay unknown. |
| Intake (#646) | Documents the `epic` and `idea` labels and form mappings to these story sections. |
| Publication (#317, #654) | Builds and deploys artifacts from validated datasets and runs hosted checks. A failed build publishes nothing. |
| Ask (#512 and its contracts) | Later produces composed `answer` views from Jev decisions over the public projection, then validates them here before display. |

## Journey

1. **Fresh open.** The browser shows ordinary pages built from the last
   validated dataset. There is no model call, and Project values show as unknown
   until #540 makes them readable.
2. **Browse.** Home epic summaries lead to epic pages. Each open issue is on
   exactly one epic page or on Not in an epic, and briefs work with or without a
   recommendation.
3. **Ask, later.** A composed `answer` view reuses the same components. The
   [composed fixture](fixtures/composed.json) is a fake-provider example over the
   same records, not a measure of Jev quality.
4. **Refresh.** Ordinary pages rebuild. A composed view re-binds or stays
   visibly out of date. A failed collection keeps the last good dataset and
   pages.

Timeouts, provider failures and late replies after a reset belong to the Ask
contracts. This definition only guarantees that nothing unvalidated renders.

## Compatibility, migration and retirement

- Version support is exact. Any change to a field, state, rule, kind, group,
  reason, bound, route or rejection code needs a new reviewed version and
  renewed approval. Additive properties are not automatically compatible,
  because objects are closed.
- The current Guide keeps consuming its own inputs and `guide-records/1.0` until
  #656's cutover. #545 creates no labels, edits no issues and removes no Guide
  sections.
- `guide-records/1.0` artifacts are retired only after no accepted consumer
  needs them, with their approval evidence preserved.
- The Ask contracts (#544, #546, #547, #548, #549) must be reconciled against
  `guide-views/1.0` before Ask pickup; nothing here approves them.

## Fixtures and approval

`fixtures/dataset.json` is a synthetic 2.0 dataset:

- a Hub epic with a Nanoleaf child whose Phase conflicts;
- a Pixoo descendant under a non-epic group;
- standalone and unresolved issues;
- completed and not-planned closures;
- a stale execution recommendation;
- a legacy story with a `## Guide` section.

`fixtures/record-cases.json` and `fixtures/view-cases.json` apply named changes
and record the expected result. `fixtures/epic-page.json` is the deterministic
ordinary example and `fixtures/composed.json` the composed example.

Run `node --test docs/work-guide/contracts/epic-guide/contracts.test.mjs` under
Node 24 after `npm ci`.

Before adoption, the delivery PR records the issue, artifact paths, versions,
candidate commit, SHA-256 bundle digest, approver, explicit approval statement,
timestamp and a durable owner-evidence link. An agent-authored statement under
shared credentials cannot supply approval, and changed bundle bytes need renewed
approval. The digest covers this folder except the test runner, plus the
normative OpenSpec delta or main specification. `digest.mjs` normalizes the
ADDED Requirements heading, the generated main-spec title and trailing blank
lines for archival. Recompute from the repository root with Node 24:

```bash
node docs/work-guide/contracts/epic-guide/digest.mjs openspec/specs/epic-guide/spec.md
```

Until the OpenSpec change is archived, pass its delta spec instead.
