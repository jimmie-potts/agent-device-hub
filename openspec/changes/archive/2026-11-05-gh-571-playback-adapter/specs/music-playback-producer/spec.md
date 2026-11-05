## Purpose

Define an explicitly invoked Mac Music source that supplies bounded observations
and listed transport controls to the existing playback owner without capturing audio.

## ADDED Requirements

### Requirement: Explicit source lifecycle and narrow endpoint authority

The producer SHALL start observations only after explicit foreground invocation,
opening its authenticated connection-bound endpoint and qualifying its native and
runtime clocks. Its distinct `music-playback-producer` role SHALL use fixed source
`bunny/parts/music-playback`, no ordinary scopes, and only playback endpoint
registration, observation/result publications and work responses. Capture roles
and the released read-only position helper SHALL retain their existing authority.
Connection loss, stop or clock invalidation SHALL fence work and own any child
until exit is confirmed, without automatic re-enrollment or command retry.

#### Scenario: Construction and registration
- **WHEN** a producer is constructed or a credential is admitted without explicit observation start
- **THEN** no native read, control or capture occurs

#### Scenario: Forbidden authority
- **WHEN** a capture credential requests playback authority, a playback credential requests ordinary read/control/ingest authority, or a source is spoofed
- **THEN** admission refuses before native work

#### Scenario: Connection loss during native work
- **WHEN** the endpoint closes while a child is active
- **THEN** the producer cancels work, refuses replacement children until exit is known and never redeclares the endpoint automatically

### Requirement: Bounded nonprompting native observations

Native observations SHALL target only the already-running Music process pinned
by PID and launch identity. They SHALL use nonprompting permission preflight and
read-only events, never launch/activate Music or request consent. One operation
SHALL run at a time, with a two-second target poll interval, no catch-up queue,
a five-second read budget and individual event deadlines at most two seconds.
The final second SHALL remain available for selected-output reads. State,
position, item identity, title, artist, album, duration and output evidence SHALL
retain separate bounded observation intervals and explicit partial/unavailable
results. The helper SHALL reject malformed descriptors and nonfinite numbers.

#### Scenario: Slow or incomplete observation
- **WHEN** position or metadata fails, or its budget expires after a valid state read
- **THEN** the result preserves the valid state and reports missing fields explicitly without copying an old field into the new observation

#### Scenario: Item changes during a read
- **WHEN** the before/after current-item identities differ or either is unavailable
- **THEN** position remains an observed value only when valid, its item association is unavailable and it cannot qualify synchronized replay

#### Scenario: Bounds and private values
- **WHEN** a result exceeds 16,384 encoded UTF-8 bytes including newline, a descriptor exceeds 65,536 bytes, a display string exceeds 256 bytes, or an output label exceeds 128 bytes
- **THEN** the boundary refuses the oversized value with fixed errors and never logs the supplied text

### Requirement: Music-declared selected outputs

The producer SHALL read Music's declared AirPlay-enabled value and current selected
AirPlay device list, with at most eight selected entries. It SHALL limit device
properties to bounded name, kind, active, available and selected observations.
The evidence SHALL identify its provenance as `music-declared-selection` and
distinguish empty, partial, unsupported, unavailable and exhausted-budget results.
It SHALL NOT enumerate the available-device catalog, read network addresses or
volume, set a route, infer physical device identity from a label, or claim that
Music's report proves audible output. A computer entry SHALL NOT identify its
underlying Core Audio output.

#### Scenario: Empty and oversized selection
- **WHEN** Music returns a valid empty list or more than eight selected devices
- **THEN** the first is observed empty selection and the second is unavailable capacity, never a truncated selected group

#### Scenario: Partial selected device
- **WHEN** Music returns a selected device but one later property read is unsupported or fails
- **THEN** the bounded selection evidence retains the successful fields and marks the omitted properties as incomplete without claiming an atomic route snapshot

### Requirement: Qualified identity and timing evidence

The producer SHALL distinguish endpoint generation, Music process epoch and a
persistent local item ID within an operator-declared Mac/library scope. None
SHALL be called a global recording identity. Native monotonic reads SHALL be
bracketed against the parent clock, and cross-host clock qualification SHALL use
actual request-send/receipt bounds. Evidence SHALL preserve original field times,
sequence and discontinuity, and SHALL NOT refresh old samples at receipt.
Missing item or position evidence and clock jumps SHALL remain explicit; speaker
latency and recording association SHALL remain unqualified.

#### Scenario: Delayed or reordered publication
- **WHEN** an old observation arrives late, a sequence regresses, or either paired clock jumps
- **THEN** it cannot become a fresh qualified source sample or authorize timed replay

#### Scenario: Local identity
- **WHEN** Music reports a persistent item ID in the configured library scope
- **THEN** consumers receive a scoped local-item identity, with operator-declared scope provenance and no recording-fingerprint claim

### Requirement: Listed controls with truthful transmission evidence

Work SHALL permit only play, pause, next and previous from the playback owner to
the exact current endpoint and process epoch. The producer SHALL reserve one
operation, reply accepted promptly, cancel any read before control, and wait for
the read child to exit. Its three-second work budget SHALL include that wait and
native startup; each event SHALL respect the smaller original expiry/budget.
Known unsent, explicit acceptance, typed refusal and unknown result SHALL stay
distinct. Native play SHALL have no item argument. Unknown child exit SHALL
prevent another child. Commands SHALL never retry or target another source.

#### Scenario: Replaced process or expired control
- **WHEN** the expected process changes or the command expires before transmission
- **THEN** no event is sent and the result reports known unsent with the fixed refusal code

#### Scenario: Lost answer after send
- **WHEN** a native event might have been sent but its answer or teardown is unknown
- **THEN** the result is uncertain unless definitive transmission evidence is available, and no automatic retry occurs

#### Scenario: Valid late evidence
- **WHEN** definitive evidence arrives for the original live endpoint/process/operation after the initial owner or caller wait
- **THEN** it remains deliverable to the owner for ADR0012 reconciliation, while retired endpoint/process evidence cannot settle a replacement operation
