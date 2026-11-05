# Music position reader specification

## Purpose

Provide explicit bounded local observations of Music.app player state and position while preserving uncertainty, process identity and the existing playback owner's authority.

## Requirements

### Requirement: Explicit read-only invocation
The reader SHALL act only on explicit invocation and SHALL send only state and position getter events to exactly one already-running Music process. It SHALL never launch or activate Music, send playback controls, capture audio, inspect track metadata or change outputs. Permission preflight and all sends SHALL be nonprompting and noninteractive.

#### Scenario: Construction and harmless checks
- **WHEN** a reader is constructed or its clock/self-test mode runs
- **THEN** it sends zero AppleEvents and performs no capture

#### Scenario: Missing process or permission
- **WHEN** no unique running Music instance is selected or permission is unavailable
- **THEN** no property request is sent and the result reports a fixed registered failure

### Requirement: Identity and independent observation evidence
The reader SHALL pin PID, bundle and launch identity and recheck them before and after each property read. An identity change SHALL discard the cycle. State and position SHALL have separate request/reply monotonic intervals, and the complete cycle SHALL fit within the supervising request interval. The reader SHALL distinguish unavailable position from zero and SHALL NOT claim an atomic snapshot, recording identity or audible timing.

#### Scenario: Position fails after state succeeds
- **WHEN** state is valid but position times out or has an invalid descriptor
- **THEN** the state remains observed with its original interval and position is explicitly unavailable

#### Scenario: Music restarts during a read
- **WHEN** the selected process identity changes before or after a reply
- **THEN** no observed state or position from that cycle is returned

#### Scenario: Invalid state or numeric value
- **WHEN** an unknown player-state enum, numeric string, boolean, negative or nonfinite position is returned
- **THEN** it is refused without coercing it into a valid playing state or position

### Requirement: Bounded supervised lifecycle
Every event SHALL have a deadline of at most two seconds. The supervisor SHALL permit one child at a time, bound the whole cycle to five seconds before teardown, bound accepted output, and fence cancelled or timed-out results. An unconfirmed exit SHALL block another child. No operation SHALL retry implicitly. A successful new process instance SHALL receive a new epoch, and read sequence SHALL never reverse within one reader.

#### Scenario: Cancelled child replies late
- **WHEN** cancellation occurs and the child later emits a valid record
- **THEN** the read remains cancelled and the late data cannot update the reader's epoch or a later result

#### Scenario: Child hangs or emits malformed output
- **WHEN** a child exceeds the deadline, output bound or closed schema
- **THEN** the supervisor ends the read with a sanitized failure, attempts bounded teardown and refuses replacement while exit remains unconfirmed

#### Scenario: Timeout dispatch is delayed
- **WHEN** elapsed monotonic time reaches the read deadline before a scheduled timeout callback runs
- **THEN** neither a newly received record nor a later clean exit can make that read successful

### Requirement: Source-only qualification
Source acceptance SHALL use descriptor fakes and synthetic child processes. The reader SHALL add no automatic polling, SDK grant, runtime playback integration, persistence or installation. Source evidence SHALL distinguish these checks from real Music access, continuous position accuracy, packaged permissions and speaker timing.

#### Scenario: Disposable acceptance
- **WHEN** the native fake and real child-pipe suites run
- **THEN** they demonstrate parsing, partial reads, intervals, generation changes, cancellation and bounded failures while sending zero AppleEvents to an application
