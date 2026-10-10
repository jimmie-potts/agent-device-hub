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

The collector SHALL attach only samples it actually observed within a defensible run window, with missing intervals and ambiguous association shown explicitly. A pause, charge or offline observation alone SHALL not complete a run. After an observed run end backed by matching record evidence, it SHALL request a bounded current map and retain the candidate run, capture times, map identity/sequence and association checks privately. A capture SHALL never be promoted to verified run attribution solely from unchanged status or summary; absent a separately qualified rule or device-side join, coverage SHALL remain unverified.

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
