## MODIFIED Requirements

### Requirement: Atomic publication and truthful freshness
Each successful observation SHALL commit one monotonic data revision and publish a validated aggregate file using a flushed same-directory temporary file and atomic replacement. Publication retries MUST NOT duplicate contributions. Separate attempt status MUST preserve the last successful observation timestamp and latest source activity date on failure. Successful empty observations MUST be distinguishable from missing, unreadable and unsupported sources. The private-store cap SHALL be 1 GiB and snapshot cap 16 MiB; capacity failure MUST preserve last-good data and never evict retained history. An interval of up to 450,000 ms (1.5 times the planned five-minute cadence) between successive successful observations SHALL count as observed. A longer interval MUST be recorded as a `not-observed` gap, and an observation following a failed attempt MUST record a `failed-attempt` gap regardless of interval.

#### Scenario: Crash around commit or rename
- **WHEN** collection stops before or after a local commit, or aggregate replacement fails
- **THEN** restart either keeps the prior revision or completes the committed pending publication without duplicate counts or falsely fresh status

#### Scenario: On-time collection jitter
- **WHEN** successive successful observations are a few seconds more than five minutes apart because run duration varies
- **THEN** no collection gap is recorded for that interval

#### Scenario: A missed collection run
- **WHEN** a scheduled run is missed and the next successful observation is more than 450,000 ms after the previous one
- **THEN** the interval is recorded as a `not-observed` gap, and consecutive `not-observed` gaps merge

#### Scenario: A failed attempt within the tolerance
- **WHEN** an observation follows a failed attempt, even within 450,000 ms of the previous success
- **THEN** the interval is recorded as a `failed-attempt` gap
