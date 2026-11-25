## ADDED Requirements

### Requirement: Wemo maximum-on limits in Conversation

The named Wemo reads SHALL report the core's current maximum-on limit for
the selected plug. They SHALL distinguish a missing limit in a synced copy
from an unknown limit while the copy is unavailable. They SHALL describe
the configured duration, enabled state, recorded status, and last attempt
outcome when present. Enforcement SHALL be described as dependent on the
Hub running and the plug being reachable. The reads SHALL send no device
or automation command.

#### Scenario: A running maximum-on limit

- **WHEN** either device read selects a Wemo plug with an armed limit whose deadline is in the future
- **THEN** it reports the start and deadline in the runtime's local time and as ISO instants, and computes the remaining duration from the clock at the read

#### Scenario: The limit is not running

- **WHEN** the selected plug has no limit, or the recorded status is disabled, unavailable, off, elapsed-unknown, due, attempted, or blocked
- **THEN** the read explains the applicable state without claiming time remaining or a confirmed off effect from an attempt receipt

#### Scenario: A deadline passed before the core updated its record

- **WHEN** the copied record is armed but its deadline has arrived
- **THEN** the read preserves the recorded status and says the deadline is already due without a positive countdown

#### Scenario: The copy is recovering

- **WHEN** the core's copy is unavailable or a replacement sync is in progress
- **THEN** the read says the limit is unknown until SDK sync restores the copy
