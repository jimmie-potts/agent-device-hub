# epic-guide Specification

## Purpose

Define the epic-based Guide records and the reusable component catalog shared by
the public browser and later Ask views, so every displayed fact traces to GitHub
or the portfolio Project and missing evidence never looks complete.

## Requirements

### Requirement: Epic placement from native relationships
The records SHALL identify epics only by the explicit `epic` label and SHALL
derive membership only from native parent links. Each issue SHALL have one
computed placement: its nearest containing epic with the full intermediate
path, root epic, standalone, or unresolved with a reason.

#### Scenario: Deep cross-repository membership
- **WHEN** a Pixoo issue's parent is a non-epic Hub issue whose parent carries the `epic` label
- **THEN** the Pixoo issue is placed in that epic with the intermediate issue in its path

#### Scenario: Parent without the epic label
- **WHEN** an issue's only ancestors lack the `epic` label
- **THEN** the issue is standalone and keeps those ancestors in its path

#### Scenario: Unknown or broken ancestry
- **WHEN** a parent list is unknown, a parent is missing from the dataset, or the chain repeats an issue
- **THEN** placement is unresolved with that reason and the issue stays browsable on Not in an epic

### Requirement: Seven-day Recently done
The records SHALL carry a dataset as-of time and a per-repository receipt for
issues closed in the seven days ending at it. Recently done SHALL be the issues
currently closed as completed with a closure time inside that inclusive UTC
window. Older closed records SHALL be retained only when ancestry or
dependencies need them.

#### Scenario: Window boundary
- **WHEN** one issue closed as completed exactly seven days before the as-of time and another one second earlier
- **THEN** the first is recently done and the second is not

#### Scenario: Other closures
- **WHEN** an issue closed as not planned inside the window, or was reopened
- **THEN** it is not recently done

#### Scenario: Older required records
- **WHEN** an open issue's parent or blocker closed long before the window
- **THEN** the closed record is retained for placement and prerequisites without appearing as recently done

#### Scenario: Incomplete closed-issue read
- **WHEN** a repository's closed-in-window read is incomplete
- **THEN** Recently done is shown as partial with a source-linked reason

### Requirement: Project planning values
The records SHALL carry Phase and Commitment from the portfolio Project as owner
intent. An epic's Phase SHALL be authoritative for its members; a differing
member value SHALL be a visible conflict. Commitment SHALL never be inherited.
Unreadable or private Project data SHALL be unknown, never empty.

#### Scenario: Private Project
- **WHEN** the Project is not verified public
- **THEN** no Project values are collected and every issue's Phase and Commitment are unknown

#### Scenario: Phase conflict
- **WHEN** an epic member records a Phase different from its epic's
- **THEN** its Phase is a conflict that keeps the recorded value, and neither Phase nor Commitment affects readiness

### Requirement: Publication boundary
A new release SHALL require complete, fresh open-issue inventories, readable
relationship lists for open issues, collected references into the primary
repositories, valid records and a safe projection. Optional enrichment failures
SHALL become visible gaps that keep every issue browsable.

#### Scenario: Truncated inventory
- **WHEN** a primary repository's open-issue pagination is incomplete
- **THEN** the dataset is not publishable and the last good release stays

#### Scenario: Degraded enrichment
- **WHEN** the Project read is denied or partial, a recommendation is stale, an optional section is malformed or the seven-day closed read is incomplete
- **THEN** the dataset is publishable with those gaps listed, and Project values are unknown rather than spliced or emptied

#### Scenario: Cached Project snapshot
- **WHEN** a permitted cached Project snapshot is used
- **THEN** its values keep their original observation time, separate from the collection time

### Requirement: Prerequisite acceptance
The records SHALL report "no open native blocker" and "prerequisite outcomes
accepted" as separate facts. Only a completed closure SHALL accept a
prerequisite's own scope; further gates SHALL be separate blocking issues.

#### Scenario: Not-planned or duplicate prerequisite
- **WHEN** a native blocker closed as not planned or as a duplicate, or with no reason
- **THEN** readiness is withheld until the dependent is re-linked to an accepted replacement or the link is removed

#### Scenario: Open acceptance gate
- **WHEN** a prerequisite is completed but a separate required-acceptance issue that blocks the dependent is still open
- **THEN** readiness is withheld with an open-prerequisite reason

### Requirement: Evidence-based readiness and projection
Readiness SHALL require an open issue with exactly `status:ready`, no blocked,
deferred or idea label, present Outcome and Acceptance, and fresh complete
prerequisite evidence. The model projection SHALL contain only selected literal
fields and never bodies, Project values or credentials.

#### Scenario: Conditional sections absent
- **WHEN** a ready issue lacks Implementation, Protections and Deferrals sections
- **THEN** readiness is not withheld for those sections

#### Scenario: Incomplete prerequisites
- **WHEN** an issue's blocker pagination is incomplete
- **THEN** readiness is withheld with a source-linked reason and the issue remains browsable

### Requirement: Shared components with complete ordinary pages
Ordinary pages and composed views SHALL use one catalog and one resolution over
the same records, with one issue card for every issue kind and one epic
component that takes epic data and child references and composes those cards.
Views SHALL contain only references and catalog choices. Each open issue SHALL
appear exactly once as a primary placement on its epic page or on Not in an
epic, each epic page SHALL list its recent completions, and repeated cards
SHALL NOT change unique counts.

#### Scenario: Complete epic page
- **WHEN** an epic page omits a placed issue or marks another page's issue as primary
- **THEN** validation rejects it with `coverage`

#### Scenario: Large epic
- **WHEN** an epic has more placed issues than a composed view may hold
- **THEN** its ordinary page still lists every one with a visible total, and a composed view holding them all is rejected with `size-exceeded`

#### Scenario: Issue from another epic
- **WHEN** an epic component's group contains an issue whose nearest epic is different
- **THEN** validation rejects it with `membership`

#### Scenario: Same record in two views
- **WHEN** an issue appears on its epic page and in a composed answer
- **THEN** both resolve to the same issue card and epic component inputs, route, link, placement and Project values, and epic counts are unchanged

#### Scenario: Unreadable Project on a board
- **WHEN** a Commitment board is resolved without readable Project data
- **THEN** every item is in the Unknown column

### Requirement: Validated composition before rendering
Composed views SHALL be bounded, SHALL carry typed reasons whose evidence code
verifies, and SHALL never define placement. Links SHALL come only from record
URLs and computed routes. Invalid views SHALL be rejected with a stable code and
never partly rendered.

#### Scenario: Injected content
- **WHEN** a view adds a URL, heading text, unknown component or unverified relation
- **THEN** validation rejects it before rendering

#### Scenario: Records refresh under a composed view
- **WHEN** record content changes while a composed view is on screen
- **THEN** the view moves to the new records only if it passes complete validation against them; otherwise it stays visible, marked out of date

### Requirement: Task briefs without inference
Task briefs SHALL always offer Explain, Plan, Implement and Review, and SHALL use
an execution recommendation only when exactly one current recommendation exists.

#### Scenario: Stale recommendation
- **WHEN** an issue's execution recommendation is stale or missing
- **THEN** the brief offers the four generic commands and marks the recommendation unused

### Requirement: Sets and sequences
Content identity SHALL ignore the order of set-valued lists and SHALL preserve
declared sequences: the owner's Phase order, Commitment options and ancestry
paths.

#### Scenario: Reordered sets
- **WHEN** issues, labels, relationship IDs or API pages arrive in another order
- **THEN** the dataset identity is unchanged

#### Scenario: Reordered Phases
- **WHEN** the owner reverses the Phase order
- **THEN** the dataset identity changes

### Requirement: Release binding
Each deployment SHALL be one release whose manifest binds records, catalog,
pages and assets with versions and generator provenance. Clients SHALL reject
mixed-release input, keep one validated release, invoke the model only on fully
supported releases and discard replies bound to another release.

#### Scenario: Deployment during an open session
- **WHEN** a new release appears while a browser is open
- **THEN** the open view stays on its release until a full reload, or asks for a reload when its assets are gone

#### Scenario: Unsupported release
- **WHEN** an older client meets a release with an unsupported records version
- **THEN** it keeps its validated view, shows an update state and does not invoke the model

#### Scenario: Outstanding request across a deployment
- **WHEN** an Ask reply names a release that is no longer current
- **THEN** the reply is discarded as obsolete

### Requirement: Contract approval and compatibility
The definition SHALL have offline fixtures and an approval record binding its
exact content before adoption. The approved `guide-records/1.0` bytes SHALL stay
unchanged, and a 1.0 dataset SHALL NOT validate as 2.0.

#### Scenario: Unapproved candidate
- **WHEN** the definition is drafted but owner approval is absent
- **THEN** it may be reviewed and tested but cannot be adopted or merged
