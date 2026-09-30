## Purpose

Define the guide component catalog and composed views so Ask the guide can
present existing records without inventing facts, while the full guide stays
the default.

## ADDED Requirements

### Requirement: Versioned catalog and view references
The contract SHALL define a versioned component catalog and view shape. Views
SHALL reference guide records by issue and sub-guide ID and bind the dataset and
catalog identities. Component-instance IDs SHALL be separate from record IDs.
Views SHALL carry no issue facts, URLs or free text.

#### Scenario: Stale or foreign binding
- **WHEN** a view names another dataset, catalog or version
- **THEN** validation rejects it with a stable code and the current view stays

#### Scenario: Same record twice
- **WHEN** one issue appears under two sections
- **THEN** each instance has its own ID, both resolve to the same record, and no membership or count changes

### Requirement: Validated composition before rendering
Code SHALL validate a composed view before rendering: supported kinds, groups,
properties and presets, record existence, sub-guide membership, duplicates,
cycles, orphans, nesting, depth and size bounds. It SHALL render nothing from a
rejected view. Links SHALL come only from referenced records and only to GitHub
pages.

#### Scenario: Cycle or second parent
- **WHEN** a component is reachable from itself or listed twice in the tree
- **THEN** the view is rejected with `cycle` or `multiple-parents`

#### Scenario: Card outside its sub-guide
- **WHEN** a sub-guide panel contains an issue that is not its member
- **THEN** the view is rejected with `membership`

#### Scenario: Injected link or text
- **WHEN** a view adds a URL, heading text or unknown property
- **THEN** the view is rejected with `schema`

### Requirement: Evidence-backed selection reasons
Every card and panel SHALL carry supported reason codes with evidence
references that code verifies against the records. Question matches SHALL cite
only fields Jev received. Code SHALL evaluate readiness and relation freshness at
use and SHALL show recorded dependencies separately from suggested order.

#### Scenario: Readiness evidence missing
- **WHEN** a candidate card's record lacks explicit ready status, acceptance or fresh prerequisite evidence
- **THEN** its ready reason is withheld with source-linked reasons and the card remains browsable

#### Scenario: Suggested order
- **WHEN** a section numbers its children as a suggested order
- **THEN** it is labelled as not a recorded dependency, and recorded prerequisites appear only through verified relations or code-computed lists

#### Scenario: Unknown dependency list
- **WHEN** the graph evidence for a dependency list is incomplete or stale
- **THEN** the list is marked incomplete or unknown, never empty

### Requirement: Full guide default and bounded motion
The Full guide SHALL be a constant view that needs no question, records binding
or provider call. It SHALL render the ordinary guide with its regions, default
collapsed sections and browsing features. Motion presets SHALL be bounded, and
reduced motion SHALL present identical facts, reasons, order and actions.

#### Scenario: Fresh open and reset
- **WHEN** the guide opens or the owner selects Full guide
- **THEN** the ordinary guide renders with its normal collapsed regions, and no composition is requested

#### Scenario: Reduced motion
- **WHEN** the reader prefers reduced motion
- **THEN** every preset is replaced by an immediate final state with the same semantic content

### Requirement: Contract-only approval and lifecycle evidence
The definition SHALL have offline success and failure fixtures, a cross-interface
trace and an approval record binding its exact content before adoption.

#### Scenario: Unapproved candidate
- **WHEN** the definition is drafted but owner approval is absent
- **THEN** it may be reviewed and tested but cannot be adopted or merged

#### Scenario: Late response after reset
- **WHEN** a response arrives after the owner returns to Full guide
- **THEN** the trace requires the view-state contract to reject it even when the response passes view validation
