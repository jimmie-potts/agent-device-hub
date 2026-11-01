## Purpose
Provide explicit, bounded Reachy companion motion through B.U.N.N.Y. with truthful simulated-device observations, controlled automatic expression and recoverable command responsibility.

## ADDED Requirements

### Requirement: Explicit simulated target and passive inspection
The integration SHALL bind one configured loopback simulated target, verify its backend identity and expose cached read-only status. It SHALL keep existing virtual companions independently usable.
#### Scenario: Backend mismatch
- **WHEN** a configured simulator answers as physical hardware or the backend is failed
- **THEN** the device is unavailable and no movement is sent
#### Scenario: Passive inspection
- **WHEN** a user opens controls or calls the status tool
- **THEN** no movement, capture, audio or enablement occurs

### Requirement: Finite tracked controls
The integration SHALL expose only notice, attention and neutral catalog gestures, bounded to ±0.2 radians and 600 ms per stage. All user commands and automatic dispatches SHALL be tracked and report responsibility separately from execution evidence.
#### Scenario: Duplicate and expiry
- **WHEN** a previously used request is repeated or its deadline expires before a stage
- **THEN** no new stage is transmitted and existing effects retain their evidence
#### Scenario: Successful simulator gesture
- **WHEN** an owned task completes with fresh consistent simulated observations
- **THEN** its tracked outcome states simulation evidence without claiming physical settling
#### Scenario: Ambiguous send
- **WHEN** an answer or move identity is lost after transmission may begin
- **THEN** the operation is uncertain, the device is held and motion is never retried

### Requirement: Explicit takeover and priority cancellation
Manual gestures SHALL require takeover. Stop and takeover SHALL clear pending work, cancel only a known owned task and disable automatic expression until explicit resume. Cancellation SHALL never imply physical stopping or send neutral, wake, sleep or torque-off implicitly.
#### Scenario: Stop during a gesture
- **WHEN** Stop arrives while an automatic gesture is running
- **THEN** cancellation bypasses normal queued work, later stages are fenced and future automatic opportunities remain suppressed until resume
#### Scenario: Recovery hold
- **WHEN** recovery is refused before sending
- **THEN** the existing hold remains
- **AND** only a guarded new person-command after operator recovery or definitive evidence can settle the hold

### Requirement: Optional live status expression
Automatic expression SHALL default off, require current core mode and session evidence, honor Quiet and takeover, have one active and one pending candidate, expire candidates after five seconds and space automatic gestures at least 30 seconds apart.
#### Scenario: Recovery and snapshots
- **WHEN** the module starts, resyncs, reconnects or returns from Quiet
- **THEN** past opportunities and stored intent produce no motion
#### Scenario: Guard changes between stages
- **WHEN** expiry, Quiet, stale observations, source invalidation or takeover occurs during an automatic gesture
- **THEN** the active task is cancelled once and no next stage is sent
#### Scenario: Notice evidence
- **WHEN** a bare turn ends without a current unacknowledged notice
- **THEN** no gesture is created and no success is inferred

### Requirement: Durable outcomes and isolated failure
The module SHALL persist accepted responsibility and outcome outbox records atomically with its state, report unfinished recovery as uncertain and preserve holds. A disconnected vendor SHALL affect only that device.
#### Scenario: Restart after admission
- **WHEN** the runtime restarts with unfinished responsibility
- **THEN** it reports the interrupted outcome without reconstructing commands or replaying any movement
#### Scenario: Storage refusal
- **WHEN** responsibility cannot be committed
- **THEN** admission is refused before any vendor write

