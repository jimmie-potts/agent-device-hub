# Shared status subscriptions Specification

## Purpose

Keep status publishers current from authenticated change notices while preserving bounded recovery, cancellation and device write policy.

## Requirements

### Requirement: Authenticated bounded latest-state notices

The shared status feed SHALL consume the existing loopback monitor change stream with its read credential, reject redirects and invalid owner/connection/version evidence, and process state/resync notices with incremental bounded parsing. Heartbeats SHALL keep the connection alive without requesting evaluation. Connection, idle, frame, stream, pending-notice and reconnect resources SHALL have finite limits. Reconnect SHALL obtain current state, not replay historical effects.

#### Scenario: Prompt notice
- **WHEN** a valid state or resync notice arrives and the evaluator is idle
- **THEN** evaluation begins within one second under a controlled clock, independently of snapshot completion or device transmission

#### Scenario: Invalid or stalled stream
- **WHEN** a stream fails authentication, stalls, closes or delivers malformed or oversized input
- **THEN** it is cancelled and reconnect remains bounded while independent polling continues

### Requirement: Coalesced evaluation and independent recovery

Each publisher SHALL run at most one evaluation and retain at most one requested rerun, which retrieves latest state. Recovery polling SHALL remain scheduled every 30 seconds while connected or disconnected; notices SHALL NOT postpone its deadline. A poll during a running evaluation SHALL coalesce with the bounded rerun rather than overlap it. Snapshot reads SHALL retain their deadline and prevent accumulation of hung requests.

#### Scenario: Notice storm
- **WHEN** many notices arrive during a pending read
- **THEN** they produce one rerun, no overlapping evaluations and no deferred recovery deadline

#### Scenario: Reconnect or missed notice
- **WHEN** a connection restarts or no notice arrives before the recovery deadline
- **THEN** the publisher retrieves the authoritative snapshot with its existing owner and selected-version checks

### Requirement: Stop retires future work

Stop SHALL cancel subscriptions, reconnect timers and pending read waits, prevent further evaluations or submissions, and preserve outcomes of writes already admitted to the controller. Optional third-party feeds that ignore cancellation SHALL never cause a new read or write after stop.

#### Scenario: Stop during read
- **WHEN** stop occurs while a snapshot read is pending
- **THEN** the publisher settles its wait within the declared bound and a late result cannot submit a write

#### Scenario: Stop during installation lookup
- **WHEN** stop occurs while Tidbyt checks installation presence before removal
- **THEN** the result cannot initiate a removal, while an already admitted write still reports its outcome

### Requirement: Device policy survives notice delivery

All writes SHALL use the existing designated queue. LIFX SHALL retain Work/Quiet/Free restrictions, manual control, transition-only no-power painting and no new paint on unavailable feed. Tidbyt SHALL retain its 15-second minimum, latest-frame coalescing, ten-minute refresh, backoff and stale-display behavior. A repeated notice or heartbeat SHALL NOT bypass those policies.

#### Scenario: Rapid changes
- **WHEN** notices arrive faster than Tidbyt permits writes
- **THEN** only the latest eligible frame is submitted at the existing write gate

#### Scenario: Feed outage
- **WHEN** snapshots become unavailable
- **THEN** LIFX submits no new paint and Tidbyt retains its existing last-good uncertainty display without removing the installation
