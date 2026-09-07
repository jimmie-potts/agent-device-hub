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
