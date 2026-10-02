## Purpose

Provide a complete public issue browser with epic navigation, reusable components and truthful source evidence, implementing Hub #511 against the approved #545 contracts.

## ADDED Requirements

### Requirement: Complete collection and safe candidate replacement
The collector SHALL collect every open non-PR issue from all three primary repositories with terminal pagination and independent reconciliation. It SHALL retain the seven-day closure slice and required older ancestors, children and prerequisites. It SHALL normalize optional metadata gaps without removing issues and SHALL reject invalid required facts, incomplete required reads and unsafe public artifacts before replacing the last accepted candidate.

#### Scenario: Optional enrichment failure
- **WHEN** recommendations or optional sections are malformed, the Project is unavailable, or recent-closure pagination fails
- **THEN** all known issues remain browsable with visible source-linked gaps and Recently done is marked partial

#### Scenario: Required refresh failure
- **WHEN** an open inventory is truncated or a required relationship read fails
- **THEN** no new candidate replaces the last accepted release

### Requirement: Canonical placement and shared components
The browser SHALL offer Home, epic pages, All issues, Not in an epic and a deterministic composed example. Ordinary and composed pages SHALL use the same issue-card, row, epic, dependency-list and brief implementations. Counts SHALL use unique canonical records, and every open issue SHALL have exactly one primary placement. Deep and cross-repository ancestry SHALL remain available without treating an ordinary parent as an epic.

#### Scenario: Large epic
- **WHEN** an epic contains hundreds of issues, including grouped and nested work
- **THEN** initial rendering is bounded, totals include all issues, and filters and Show more reach every record

### Requirement: Truthful work and completion evidence
The browser SHALL distinguish no open blocker from accepted prerequisite outcomes, preserve closure reasons and Project unknown states, and withhold Up next when the accepted ready gate fails. Recently done SHALL use inclusive UTC seven-day boundaries against dataset asOf and exclude reopened and not-planned records.

#### Scenario: Unaccepted prerequisite
- **WHEN** a native prerequisite was cancelled or has an unresolved duplicate closure
- **THEN** the dependent is not shown as eligible Up next and the missing acceptance evidence is visible

### Requirement: Accessible navigation and safe briefs
The browser SHALL preserve shareable search/filter and Back state, theme, keyboard/focus, reduced motion, mobile destinations and per-page print. Briefs SHALL offer Explain, Plan, Implement and Review without inference. Valid current recommendations SHALL add guidance; absent, stale, insufficient or malformed recommendations SHALL use generic commands. Copy SHALL never execute commands and SHALL offer a selectable-text fallback.

#### Scenario: Navigation and clipboard failure
- **WHEN** the reader navigates from filtered results into a brief and returns, or clipboard permission is denied
- **THEN** filters are retained and the command remains available as selectable text

### Requirement: Literal public data and coherent releases
The browser SHALL render source text literally, use only trusted canonical links, exclude credentials and private Project/runtime data, and make no model request on open. One release SHALL bind pages, records, catalog and assets with supported versions and hashes. An open client SHALL retain its validated release or offer an explicit reload/update state when deployment changes, without mixing artifacts.

#### Scenario: Deployment during browsing
- **WHEN** the server replaces the release or removes old assets while the client is open
- **THEN** navigation, search and briefs continue from its pinned validated records or show an explicit unavailable/update state

#### Scenario: Mixed or unsupported input
- **WHEN** a release has mismatched hashes, identities or unsupported schema versions
- **THEN** the browser refuses it before rendering records or making any model request
