# roborock-observations Specification

## Purpose

Let the owner inspect Roborock observations and privately retained cleaning history through B.U.N.N.Y., while preserving collection gaps, freshness and the limits of run attribution. This capability implements the source behavior in Hub #376.

## Requirements

### Requirement: Configured read-only module

The runtime SHALL admit the shipped Roborock module through its existing registration and configuration interfaces. Missing or invalid configuration SHALL produce a named module refusal while unrelated modules continue. Construction and startup SHALL contact no account or robot; subsequent collection SHALL use only the configured observational transport. Simulation SHALL use synthetic inputs and send no vacuum controls.

#### Scenario: Unconfigured module
- **WHEN** the runtime has no Roborock configuration section
- **THEN** the module catalog reports its refusal and the core and other configured modules continue

#### Scenario: Lazy startup and unsupported controls
- **WHEN** a configured module starts or an operator reads its records
- **THEN** startup completes without waiting for a device, reads use no cleaning controls and generic command capabilities remain unsupported

### Requirement: Truthful current observations

The module SHALL initially poll every 60 seconds while docked and every 15 seconds while cleaning or returning, through one serialized observation loop with bounded calls and failure backoff. It SHALL expose observed state, battery, current-run measurements, dock information, consumable usage and robot-reported totals when supplied. Missing, invalid or unqualified values SHALL remain unknown. Observation times SHALL survive failures and restart; service health SHALL never refresh device evidence.

#### Scenario: Missing fields and raw codes
- **WHEN** a successful response omits fields, includes nulls or supplies an unfamiliar numeric code
- **THEN** absent or invalid measurements are unknown, the raw code is retained and no zero, false or normal meaning is invented

#### Scenario: Docked counters and active cadence
- **WHEN** docked observations retain prior cleaning counters, followed by evidenced cleaning or returning observations
- **THEN** the old counters create no active run, the active observation policy changes to 15 seconds and reads never overlap

#### Scenario: Unavailable input
- **WHEN** a read times out or the device disappears
- **THEN** status reports unavailable input with its original observation time, preserves supported history and infers no run completion

### Requirement: Durable private history

One module SHALL own the private store outside Git and Windows mounts. It SHALL retain original readings, records, observed samples, room mappings and capture provenance without automatic expiry. Runs SHALL be idempotent by robot identity and requested record identifier, with a returned identifier checked before association. Every available summary identifier SHALL be reconciled at startup and observed run end through bounded work. A subset, missing summary or failed record read SHALL neither erase retained history nor manufacture completeness.

#### Scenario: Restart and summary subset
- **WHEN** the collector restarts and the robot supplies only a subset of previously retained records
- **THEN** retained runs remain, known identifiers are not duplicated, available new identifiers are reconciled and unobserved battery intervals remain gaps

#### Scenario: Conflicting record identity
- **WHEN** a requested cleaning record reports a different start identifier
- **THEN** it is retained as refused association evidence and supplies no samples or map to the requested run

#### Scenario: Interrupted or full store
- **WHEN** persistence fails before commit, including an interrupted transaction or full disk
- **THEN** the collector reports failure, claims no new stored data and preserves the previously committed history

#### Scenario: Publication after commit fails
- **WHEN** a collection transaction commits but its status publication is refused
- **THEN** committed data remains stored and recovery republishes it without repeating collection effects

### Requirement: Evidence-bound samples and map captures

The collector SHALL attach only samples it actually observed within a defensible run window, with missing intervals and ambiguous association shown explicitly. Returning observations SHALL remain retained and SHALL NOT extend the cleaning window used for association beyond its cleaning observations. A pause, charge, returning or offline observation alone SHALL not complete a run. After an observed run end backed by matching record evidence, it SHALL request a bounded current map and retain the candidate run, capture times, map identity/sequence and association checks privately. A capture SHALL never be promoted to verified run attribution solely from unchanged status or summary; absent a separately qualified rule or device-side join, coverage SHALL remain unverified.

#### Scenario: Observed run with partial battery evidence
- **WHEN** matching record evidence resolves an observed run with a collection gap
- **THEN** its detail contains only observed eligible samples, explicitly shows the gap and invents no missing points

#### Scenario: Candidate map captured in the observed window
- **WHEN** a matching run ends and the current-map read succeeds with consistent pre/post observations
- **THEN** the original map and association evidence are retained as a candidate capture, while coverage remains unverified

#### Scenario: Failed, delayed or ambiguous capture
- **WHEN** map retrieval fails, completes after its bounded window, crosses an observation gap or conflicts with a newer run
- **THEN** the run's supported totals remain and its map availability reports missing or unverified rather than attributing another run's map

#### Scenario: Run discovered after downtime
- **WHEN** startup reconciliation discovers a historical run that the collector did not observe ending
- **THEN** it retains the record without fetching a current map as that run's historical map or inventing battery samples

#### Scenario: Cleaning record ends before return-to-dock finishes
- **WHEN** an observed cleaning run has a completed matching record, followed by returning observations after its reported end and an evidenced dock boundary
- **THEN** the run retains only eligible observed battery samples, admits its bounded current-map capture with unverified association, and preserves returning originals without extending the cleaning window or guessing a clock offset

#### Scenario: Returning without observed cleaning
- **WHEN** the collector first observes only returning activity after a historical completed record has ended
- **THEN** those later observations do not associate that old record with new samples or trigger its historical map capture

### Requirement: Validated owner-addressed reads

The module SHALL publish complete revisioned `roborock-vacuum/2.0` status and the existing generic device record through profile 2.0, with owner-addressed sync over both SDK transports. Vacuum-specific data SHALL remain outside the generic device schema. Authenticated module reads SHALL provide bounded pages of run summaries and samples, validated against the declared schemas. Raw records, room names, map bytes and geometry SHALL remain private and outside message envelopes. Invalid queries, unknown references and cancelled reads SHALL return the shared refusal codes instead of successful empty results.

#### Scenario: Revisioned sync on both transports
- **WHEN** a reader syncs the Roborock owner over either supported SDK transport
- **THEN** it receives the same complete device/status records with revisions and original evidence times, within the message bound

#### Scenario: Bounded history and refused reads
- **WHEN** a reader asks for a page, malformed query, unknown run or cancelled read
- **THEN** valid results respect declared limits and pagination, and invalid or unavailable input yields a registered refusal without device controls

#### Scenario: Authentication and Origin refusal
- **WHEN** an unauthenticated request, disallowed Origin or command attempt reaches the runtime
- **THEN** the existing gateway permissions refuse it and zero vacuum control commands are sent

### Requirement: One page and current-status tool

The module SHALL contribute its React page at `#/module/roborock/status` using the shell's one authenticated connection and existing navigation. The page SHALL show current status, stale/unavailable evidence, paged runs and a selected run's battery samples with gaps. Its read-scoped `roborock_status` MCP tool SHALL return the same current record. Neither interface SHALL collect on demand, acknowledge notices or control the vacuum. The page SHALL support keyboard use, narrow viewports, reduced motion, reconnect and leaving/re-entering without leaked subscriptions or fabricated freshness.

#### Scenario: Status, history and battery journey
- **WHEN** the owner opens the simulated module page, pages through retained runs and selects a run
- **THEN** the page shows supported status and run measurements, only observed battery samples and explicit missing-history or gap states

#### Scenario: Reconnect and page lifetime
- **WHEN** the shell disconnects, reconnects or leaves and re-enters the page
- **THEN** the page retires obsolete responses and subscriptions, resyncs current state on the same shell connection and preserves evidence age

#### Scenario: Read-scoped MCP status
- **WHEN** an authenticated read-scoped client invokes `roborock_status`
- **THEN** it receives the page's current status record without a collection effect, history tool or vacuum control

#### Scenario: Accessible inspection
- **WHEN** the owner navigates by keyboard on a narrow viewport with reduced motion
- **THEN** status and history controls remain usable, chart evidence has a readable text alternative and applicable accessibility checks pass

### Requirement: Reusable quiet Roborock card

Home and the Roborock status page SHALL reuse the same read-only card with a persistent vacuum illustration, Status, Last run and Care tabs, a corner warning disclosure and History navigation. Tab changes SHALL preserve card dimensions and the illustration. Existing saved Home placements SHALL remain valid. Small and wider placements SHALL retain the card format and expose observed state and battery; the run and care tabs SHALL expose the additional summaries. Detailed observations and paged run/sample evidence SHALL remain reachable without filling the default card with technical text. The interface SHALL support keyboard access, narrow screens, both themes and reduced motion.

#### Scenario: Home and module-page reuse
- **WHEN** the owner opens the configured vacuum on Home or the Roborock page and changes tabs
- **THEN** the same card presentation is used, its image and dimensions stay stable, and no command is sent

#### Scenario: Passive history and evidence
- **WHEN** the owner opens History or the full observations disclosure
- **THEN** existing bounded run/sample views remain usable and navigating back sends no vacuum command

#### Scenario: Unconfigured or refused source
- **WHEN** the module is unconfigured, refused or unavailable and has no generic device record
- **THEN** Home still offers a Roborock card whose unavailable disclosure does not invent a target, battery or normal state

### Requirement: Source-bound card evidence

The card SHALL use the existing authenticated shell participant, owner-addressed sync and bounded module content reads. It SHALL validate target, document and envelope identities and monotonically ordered records. Conflicting equal revisions SHALL invalidate current evidence until an explicit reload or fresh scope. Obsolete reads and callbacks SHALL NOT replace the selected source. Leaving the card SHALL close its scoped copies and reads without closing other consumers. A local display clock SHALL age evidence without polling the Hub or robot.

#### Scenario: Superseded or conflicting input
- **WHEN** a lower revision, conflicting equal revision, wrong target or late response from an old scope arrives
- **THEN** it cannot establish current card data, no raw response or exception is rendered, and only the owning registered refusal code is disclosed

#### Scenario: Reconnect and cleanup
- **WHEN** the card is hidden, unmounted, re-entered or reconnected
- **THEN** it releases retired scopes, syncs current membership on the existing shell participant and sends zero device commands

### Requirement: Truthful compact Roborock measurements

Current state and battery SHALL age from their retained observation timestamp, independently of service health. Status observations older than 120 seconds, missing timestamps, future timestamps or a lost status stream SHALL NOT be described as current. Care usage SHALL use its own observation time and SHALL NOT become fresh from a newer status observation. Current cleaning counters SHALL appear only with fresh cleaning activity. Other state codes SHALL remain numeric instead of acquiring unqualified dock, charge or completion labels. The latest recorded run SHALL be the retained run with the greatest reported start time, independently of archive insertion/reconciliation order. Its owning read SHALL return at most one validated record without accepting caller-selected sorting or arbitrary queries. It SHALL retain its robot-reported time with unqualified-clock context, duration and distinct cleaned-area measurement; a known end time SHALL NOT establish completion without complete code 1. Missing measurements SHALL remain unknown. Care SHALL show recorded usage without invented remaining life, deadlines or maintenance thresholds. Nonzero evidenced error/dock codes SHALL use the corner disclosure without invented meanings.

#### Scenario: Stale observation and independent care age
- **WHEN** the display clock passes the status age bound or care is older than the current status
- **THEN** stale evidence is labelled and disclosed without inventing a new reading or running a periodic content read

#### Scenario: Independent run fields and completion
- **WHEN** the last record has different reported-area and cleaned-area fields or lacks complete code 1
- **THEN** the card uses cleaned area without substituting reported area and does not label that record completed

#### Scenario: Unknown values and safe warnings
- **WHEN** a field is missing, a vendor code is unfamiliar or a read fails
- **THEN** unknown values and fixed refusal context remain distinguishable from zero, normal operation and an empty history

#### Scenario: Older history reconciled after a newer run
- **WHEN** an older run is saved after a newer run
- **THEN** Last run still selects the greatest reported start time while existing history pagination keeps its order and the latest-run read returns only that one record
