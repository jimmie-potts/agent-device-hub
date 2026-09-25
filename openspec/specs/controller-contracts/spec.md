# Controller contracts

## Purpose

Define portable controller messages and conformance behavior so device clients preserve ownership, privacy and the limits of available evidence.

## Requirements

### Requirement: Configured identity and typed capabilities
Messages SHALL use stable configured device/controller/source IDs, explicit supported or unsupported capabilities, closed typed operations and safe counters. They MUST reject caller-selected raw targets, paths, reset/firmware commands and private content. Source: #4 criteria 1, 2 and 8.

#### Scenario: Unsupported media on an ordinary light
- **WHEN** a light with media unsupported receives a media command
- **THEN** the conformance decision is unsupported-capability and schedules no effect

### Requirement: Independent observation evidence
Snapshots SHALL distinguish desired and pending settings, last successful transmission, latest outcome, external control and observation age from service health. Unknown values MUST remain explicit; sent SHALL mean transport acknowledgment only. Source: #4 criterion 3.

#### Scenario: Health without device evidence
- **WHEN** a ready service reports no device observation
- **THEN** the snapshot retains unknown observation and does not claim physical connectivity or optical proof

### Requirement: Versioned bounded replay
Requests and receipts SHALL carry API version, request epoch/sequence, configuration revision and output generation. Exact duplicates MUST return historical results without execution; conflicting duplicates, expired identities, stale generations and future sequences MUST reject. Evicted old identities MUST NOT execute anew. Source: #4 criterion 4.

#### Scenario: Evicted duplicate
- **WHEN** an old sequence has left the receipt cache
- **THEN** the decision is request-expired, with no effect and no new identity reservation

### Requirement: One designated device writer
Clients SHALL delegate through the configured owner. Queued effects MUST recheck generation immediately before transmission and preserve possible prior effects when cancellation follows a partial send. Reconnect and reads MUST NOT replay commands or claim ownership. Source: #4 criterion 6.

#### Scenario: Cancelled pending generation
- **WHEN** queued work belongs to a retired generation
- **THEN** no new send occurs and the cancellation preserves any prior transmission evidence

### Requirement: Bounded snapshot and feed recovery
Snapshots and change feeds SHALL use a separate versioned cursor epoch/sequence. Retained cursors MUST yield later ordered snapshots; unknown, expired, future or changed-epoch cursors MUST require authoritative full resync without effects. Source: #4 criterion 4.

#### Scenario: Expired cursor
- **WHEN** a client reconnects outside retained feed history
- **THEN** the decision requests a full resync and does not execute commands

### Requirement: Native authentication and admission
Machine requests SHALL authenticate independently of browser tokens, preserve Host and supplied-Origin protection, default to loopback and enforce declared read/control/device scopes. Revocation MUST precede replay and authorize streams continuously. Finite request, queue, replay and stream limits MUST reject before effects. Source: #4 criterion 5.

#### Scenario: Revoked cached request
- **WHEN** a revoked principal repeats a cached successful command
- **THEN** authentication fails before returning cached content or performing an effect

### Requirement: Renderer epochs and clock compatibility
Renderer metadata SHALL identify device profile/version, renderer/output epochs, update outcome and controller-monotonic clock epoch. Timing estimates MUST derive from a compatible fresh sampled duration and local elapsed duration. Unsupported profiles, stale samples or unknown epochs MUST remain unsupported or unknown. Source: #4 criterion 7.

#### Scenario: Different monotonic origins
- **WHEN** two processes interpret the same compatible deadline and sample
- **THEN** both compute the same remaining duration without subtracting clocks across processes

### Requirement: Portable artifact compatibility
The versioned artifact SHALL include strict schemas and one fixture corpus consumed by TypeScript and Python. Both consumers MUST agree on schema and semantic cases. Unknown API versions MUST reject. Consumer adoption MUST pin immutable source/artifact checksums and MUST NOT use sibling worktree imports or concurrent cross-OS SQLite access. Source: #4 criterion 8.

#### Scenario: Portable conformance
- **WHEN** the packed artifact is extracted outside the source checkout
- **THEN** both language consumers validate the shared fixtures and report matching expected decisions

### Requirement: Typed moment command and capability
API 1.1 SHALL carry a `moment` command with a neutral moment ID from the triggering event, a declared mood, an optional palette of 1 to 8 colors, a duration from 1,000 to 300,000 milliseconds, an `event` or `flourish` priority class, a status-cover flag and a start time. Only `event` moments MAY cover status presentation. The command and the capability MUST reject frames, raw protocol, titles and other unknown fields. A 1.1 capability set SHALL declare `moments` as unsupported or as supported, with 3 to 64 unique moods including `celebrate`, `setback` and `reminder`, a duration limit within the contract range and whether status can be covered. Admission SHALL apply every 1.0 rule first, then reject an undeclared mood or an over-limit duration as unsupported-capability. The status-cover flag is a permission that the device writer applies. It MUST NOT be rejected at admission. An accepted moment MUST NOT advance the configuration revision. Source: #292 decisions 2 and 5; ADR 0006.

#### Scenario: Undeclared mood
- **WHEN** a 1.1 controller whose moments capability lacks `party` admits a moment with mood `party`
- **THEN** it retains a failed 1.1 receipt with unsupported-capability and schedules no effect

#### Scenario: Flourish over status
- **WHEN** a moment sets priority class `flourish` and covers status
- **THEN** schema validation fails before admission

#### Scenario: Moment keeps concurrent edits valid
- **WHEN** a 1.1 controller queues a moment
- **THEN** its receipt keeps the current configuration revision, so another client's pending edit does not conflict

### Requirement: Compatible API 1.1 negotiation
API 1.1 SHALL be opt-in and leave every 1.0 definition, validator and admission decision unchanged. A 1.1 controller SHALL accept 1.0 and 1.1 envelopes on one ticket sequence, and each receipt SHALL carry its request's API version. A 1.0-only controller, or any unknown version, MUST reject a 1.1 envelope as invalid-request without reserving a ticket. A snapshot or feed read without a version signal SHALL be served at 1.0. A read that names a version SHALL be served at the highest version the controller has that has the same major and is not above it. Another major or a malformed version MUST be invalid-request. A controller built before 1.1.0 MAY reject the version signal; a client that receives invalid-request for a versioned read SHALL treat the controller as 1.0-only, read again without the signal and send it no moments. A 1.1 controller serving a 1.0 reader SHALL omit the moments capability, the moment state and pending moment entries, and SHALL report a 1.1 last outcome as unknown. Source: #292 decision 6 and assumptions.

#### Scenario: 1.0-only controller
- **WHEN** a controller without API 1.1 receives a 1.1 moment request
- **THEN** the decision is invalid-request with no reservation and no effect

#### Scenario: Read without a version signal
- **WHEN** a reader that sends no version reads a controller that serves 1.0 and 1.1
- **THEN** it receives a 1.0 snapshot, and a reader asking for 1.7 receives 1.1

#### Scenario: Controller built before 1.1
- **WHEN** a 1.1 client's versioned snapshot read gets invalid-request from a controller built before contract 1.1.0
- **THEN** the client reads again without the version signal, uses the 1.0 snapshot and sends that controller no moments

#### Scenario: 1.0 reader of a 1.1 controller
- **WHEN** a 1.1 snapshot with a playing moment, a pending moment and a moment-blocked outcome is served to a 1.0 reader
- **THEN** the reader receives a valid 1.0 snapshot without moment content, its other pending work, and an unknown last outcome

#### Scenario: Existing corpus
- **WHEN** both language consumers run the 220 cases that predate API 1.1
- **THEN** every case still produces its original expected result

### Requirement: Moment start in the controller clock
A moment's start SHALL use the receiving controller's monotonic clock domain and epoch, with a tolerance of at most 60,000 milliseconds. The hub derives it from the device's snapshot clock sample and its own elapsed time. The device MUST drop a moment as moment-missed when the clock epoch differs, when it would start more than the tolerance late, or when the start is more than 60,000 milliseconds ahead. It SHALL apply the lateness rule when the writer takes the moment and again, while the moment is scheduled, before handling any later event. A missed moment MUST NOT be queued or replayed. Source: #292 decision 1; ADR 0006 degradation.

#### Scenario: Late delivery after a hub outage
- **WHEN** a moment arrives after its start plus tolerance
- **THEN** the device drops it as moment-missed and starts nothing

#### Scenario: Stalled writer at the scheduled start
- **WHEN** a scheduled moment's start is reached more than its tolerance after the start time
- **THEN** the device drops it as moment-missed and never plays it

#### Scenario: Start within tolerance
- **WHEN** a moment arrives exactly at its start plus tolerance
- **THEN** it plays for its full duration from arrival

### Requirement: Moment precedence and return to base
A device writer SHALL play at most one moment at a time. It MUST drop a recent moment ID as moment-duplicate, retaining at least the last 64 IDs per clock epoch. It MUST drop a moment as moment-blocked in quiet presentation, on status presentation when the moment lacks status cover, the device cannot cover status or an attention or failure alert is active, and for a flourish while an event moment is current. A device that cannot cover status SHALL still play a status-covering moment over content. Otherwise the new moment SHALL replace the current one, which ends as superseded. An attention or failure alert on status presentation SHALL pre-empt a scheduled or playing moment. Alerts MUST NOT pre-empt or override content. Any explicit command, including a mode change, SHALL interrupt the moment. When a moment ends, the device SHALL show its current base and never a saved earlier one, and no moment SHALL change the mode. A playing moment SHALL end on the device clock without the hub. A restart SHALL resume and replay nothing. Source: #292 decisions 3 and 4, its review comments and ADR 0006.

#### Scenario: Current base after a status change
- **WHEN** status changes during an interlude and the interlude's duration elapses
- **THEN** the device shows the changed status, and the moment ends as completed

#### Scenario: Alert on status and on content
- **WHEN** a failure alert arrives during a moment on status presentation, and separately during a moment on content
- **THEN** the status moment ends as preempted and the device shows the alert, while the content moment keeps playing to completion

#### Scenario: Second moment
- **WHEN** a newer event moment arrives during a moment, and separately a flourish arrives during an event moment
- **THEN** the event supersedes the current moment, and the flourish is dropped as moment-blocked

#### Scenario: Mode change mid-interlude
- **WHEN** the mode changes from Free to Work during an interlude
- **THEN** the moment ends as interrupted, and the device shows Work status without replaying the moment later

#### Scenario: Restart
- **WHEN** the controller restarts during an interlude
- **THEN** it shows its current base, its moment memory is empty, and a redelivery with the old clock epoch is missed

### Requirement: Moment evidence
Moment receipts SHALL keep transmission-only meaning. A dropped moment, including one reached too late at its scheduled start, gets a failed receipt with a moment failure code that only 1.1 receipts carry. A moment dropped at its scheduled start records no ending. A started moment gets sent, and a scheduled moment that ends before starting gets cancelled with no prior effects. The 1.1 snapshot SHALL report the current moment as none, scheduled or playing with its instants, and SHALL report the last ended moment with completed, preempted, superseded or interrupted and its end instant. Every instant uses the controller clock. Source: #292 decision 4.

#### Scenario: Cancelled before start
- **WHEN** an explicit command arrives while a moment is scheduled
- **THEN** the moment's receipt becomes cancelled with no prior effects, and the snapshot's last moment reports interrupted
