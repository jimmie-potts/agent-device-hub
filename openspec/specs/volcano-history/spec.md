# volcano-history Specification

## Purpose
Record private usage facts for one enrolled VOLCANO HYBRID from a read-only host-local collector, derive sessions when they are read and serve them through authenticated bounded reads, without any device command.

## Requirements

### Requirement: Facts from a source-bound feed

The runtime SHALL ship one `modules/volcano` module for one configured feed, whose section SHALL be exactly `id`, an optional `label`, `hostId` and `sourceId`, and it SHALL take only well-formed `volcano-observation` snapshots of that feed from a remote part. It SHALL be the only writer of its private SQLite store and SHALL store facts, never sessions: heater and pump transitions with raw `status1`, setpoint changes, temperature samples only while the heater is on and at most one per 30 s plus at transitions, counter readings on change, link and collector-restart markers, unobserved gaps and discontinuities. Every fact SHALL keep its observation and receipt times separately. Heater SHALL decode from `status1` bit `0x0020` and pump from `0x2000`, and `status2` bit 13 SHALL never count as a change.

#### Scenario: Replay of physical use
- **WHEN** snapshots report HEAT, a setpoint change, a pump run of the device's own and one from the button, then off, and no command is sent
- **THEN** the facts and the read routes hold each transition with its raw register and both times, a pump run claims no press, and the module has requested nothing

#### Scenario: Refused snapshots
- **WHEN** a snapshot names another feed, comes from a source that is not a remote part or is malformed
- **THEN** it adds no fact, and one refusal is logged with a registry code and no identifier

### Requirement: No fabricated continuity

A snapshot repeating its `(collectorEpoch, sequence)`, or whose `observedAtMs` is not newer than the ordering baseline, SHALL add no fact and renew no freshness, and once the feed has been stale for 15 s such a snapshot SHALL move the baseline to its own stamp without giving evidence. A missing observation SHALL stay unknown: a disconnect or a stale feed SHALL never record off. When observation resumes after a broken link, more than 15 s of silence, a skipped `sequence` within an epoch or a new collector epoch, the module SHALL record one gap with the heater on each side. Its credit SHALL be the counter's gain in whole minutes only when a counter was read on each side, with no discontinuity and no reading without a counter since the first of them; otherwise it SHALL be null, never zero. A counter decrease, a gain larger than the elapsed minutes plus one, a changed identity or a stepped clock SHALL record a discontinuity that no delta crosses.

#### Scenario: Duplicates and delayed snapshots
- **WHEN** heartbeats repeat, the same sequence arrives again, an older stamp arrives late and `status2` bit 13 flips
- **THEN** no fact, accumulated time or published state changes

#### Scenario: A skipped sequence
- **WHEN** a snapshot arrives within 15 s of the last, but its sequence skips one
- **THEN** a gap is recorded, and a transition it shows has an `after-gap` edge rather than an observed one

#### Scenario: Counter decrease and jump
- **WHEN** the counter reads 120 h 05 min and then 3 h 00 min, or gains more minutes than have passed
- **THEN** a discontinuity is recorded and the gap holds no credit

#### Scenario: A counter unknown on reconnecting
- **WHEN** the link breaks and the first reading after it has a counter that is reset, or larger than the time allows
- **THEN** the gap's credit is null, not zero, and the confirmed counter records one discontinuity

#### Scenario: A stepped clock
- **WHEN** a snapshot's stamp is not newer and the feed has gone stale, and the next snapshot is newer than that stamp but older than the last one taken
- **THEN** the first gives no evidence, the second is taken with a `clock-step` discontinuity, and whatever was open ends with no end time

### Requirement: Read-time sessions

Sessions SHALL be derived when read: heater-on stretches separated by less than the threshold, 15 minutes by default, SHALL form one session, and changing the threshold SHALL regroup all history without rewriting a fact. A stretch first seen on SHALL be `startedBeforeObservation` from the time first seen, with no earlier start. An unobserved interval SHALL create no boundary inside it. An end hidden in a gap SHALL have no end time, only the time last seen on and the time first seen off. A session SHALL mean heater activity, and no document SHALL have a field for consumption, dose or inhalation.

#### Scenario: Manual use
- **WHEN** HEAT goes on at 20:00 and off at 20:25
- **THEN** there is one session from 20:00 to 20:25 with one stretch

#### Scenario: Auto-off then restart
- **WHEN** the heater is on at 20:00, off at 20:30, on at 20:38, off at 20:50 and on again at 21:30
- **THEN** 20:00 to 20:50 is one session of two stretches, and 21:30 starts another

#### Scenario: First connection mid-session
- **WHEN** the first observation at 20:10 reads the heater on
- **THEN** the stretch starts at 20:10, flagged as started before observation

#### Scenario: Missed interval
- **WHEN** the link is gone from 20:10 to 20:20 with the heater on at both edges and the counter has gained minutes
- **THEN** the interval shows unobserved inside one stretch, the gain is credited in whole minutes apart from observed time, and no threshold divides it

#### Scenario: Regrouping
- **WHEN** the threshold changes, or a read previews another one
- **THEN** the sessions regroup, every stored fact is unchanged, and a preview changes no setting

### Requirement: Observed state and freshness

The module SHALL publish `bunny.state.device.<id>`, kind `volcano` with every capability unsupported and observed unknown, and `bunny.state.volcano-status.<id>` under `volcano-status/2.0`. A feed stale for 15 s, a link not connected or a start with no snapshot yet SHALL make availability `unavailable` and heater and pump `unknown`, never off. Repeated snapshots SHALL publish nothing new. Core history SHALL keep neither the raw snapshot nor `volcano-status`, so the module stays the only owner of usage history; the device record SHALL stay in core history, and its rows SHALL follow availability, never temperature, heater, pump or counter.

#### Scenario: No usage in core history
- **WHEN** snapshots change the temperature, heater, pump and counter
- **THEN** core history gains no row and no usage field, and its device rows still show availability changing

#### Scenario: Collector absent
- **WHEN** snapshots stop while the heater was on
- **THEN** at 15 s consumers hear unavailable and unknown, no off fact exists, and the next reading records an unobserved gap

### Requirement: Durable and bounded reads

Facts and threshold SHALL survive an ordinary restart, and there SHALL be no delete or release control. Facts, continuity and state messages SHALL commit in one transaction through the outbox. A full disk SHALL refuse before anything is accepted, and recording SHALL resume when a commit succeeds. Reads SHALL be the fixed projections `status`, `timeline`, `sessions`, `totals` and `gaps`, each closed, checked against its schema, bounded by page and at most 256 KiB, each taking only its own validated query fields, under the gateway's existing read authorization, plus a `status` MCP tool. No log record SHALL carry usage, serial or a raw host or source ID; a routing key carrying the hashed feed ID is the same as for other feeds. A connection, a collector restart and a discontinuity SHALL each leave one private record of registered fields.

#### Scenario: Restart
- **WHEN** the module restarts, including between a commit and its publication
- **THEN** its facts and sessions are as they were, the stored messages go out again and no fact is repeated

#### Scenario: Full disk
- **WHEN** a commit fails with a full disk
- **THEN** no fact is half stored, a threshold request answers `capacity`, reads still work, `recording` says `refused`, and a later commit records again

#### Scenario: Authorization
- **WHEN** a read arrives with no credential, an unknown one, a collector's, or a query field the reference does not take
- **THEN** it is refused with `unauthenticated`, `unauthenticated`, `forbidden` and `invalid-request`

### Requirement: Threshold command

`volcano-session-gap/2.0` on `bunny.cmd.volcano-session-gap.<id>`, with `requestId`, `gapMinutes` and an optional `expectedConfigurationRevision`, SHALL go through the core's tracked dispatcher and SHALL never reach a device. It SHALL be idempotent by request ID and digest. Stored, it SHALL report `succeeded` with `observed` evidence; outside 1 to 240 minutes it SHALL report `failed` with `invalid-request` and change nothing; a stale revision, an expired command and a full disk SHALL be refused before acceptance.

#### Scenario: Repeat and conflict
- **WHEN** the same request ID arrives with the same content, after a restart too, and then with other content
- **THEN** the first is accepted with no second outcome, and the other is `duplicate-conflict`

### Requirement: Read-only collector

The runtime SHALL ship a host-local collector whose transport has only scan, connect, read, subscribe and disconnect, limited to the fixed allowlist of status, temperature and counter characteristics, plus the serial for reading only, and SHALL have no write path. The serial SHALL be compared with a private SHA-256 and SHALL never be published, logged or kept; a mismatch SHALL publish `identity-mismatch` and disconnect. It SHALL stay connected on notifications plus a 5 s poll, publish with `publishOnce` on change at most once a second and at a 5 s heartbeat when it has newer evidence, stamp a reading with the time of its evidence and never of its sending, never retry a publication and reconnect with bounded backoff from 2 s to 60 s. Temperatures SHALL be published in degrees Celsius times ten. A publication SHALL never carry an hours and minutes pair torn across an hour boundary: a pair not moving forward by what the time allows SHALL be published as unread until a later read at least 4 s on confirms it. The real binding SHALL live in a non-workspace package pinning `@stoprocent/noble` 2.8.0, so the root lockfile and container image gain no native dependency.

#### Scenario: No write can be expressed
- **WHEN** a whole session runs against a fake noble and a fake transport that fail on any write-shaped call or other characteristic
- **THEN** every call is among the permitted operations, and any other UUID is refused before the device

#### Scenario: A rollover notified in two halves
- **WHEN** the counter rolls from 12:59 to 13:00 and hours and minutes notify separately, in either order
- **THEN** only 12:59 and 13:00 are published, and the module records no discontinuity

#### Scenario: A tick only the poll saw
- **WHEN** a register changes with no notification
- **THEN** the next poll publishes it

#### Scenario: Another device
- **WHEN** the serial's hash differs
- **THEN** the collector publishes `identity-mismatch` with no reading, reads nothing further and disconnects
