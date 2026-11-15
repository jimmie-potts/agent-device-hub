# presence-pro-observations Specification

## Purpose
Expose stock Everything Presence Pro device-reported occupancy, zones and
approximate anonymous positions through the existing private runtime, with
connection-scoped uncertainty and saved apartment calibration.

## Requirements

### Requirement: Direct stock acquisition and configured security
The runtime SHALL host one fixed read-only Presence Pro module for up to two
explicit sensors, discover configured typed keys each connection, verify device
identity and preserve selected authentication without downgrade. One bounded
reconnect owner per sensor SHALL isolate failures.

#### Scenario: Two initial subscriptions
- **WHEN** two configured synthetic stock Native API sources connect
- **THEN** each sensor has its own current reported occupancy, zones, hold state
  and available slot scalars, including firmware-cached initial reports

#### Scenario: Authentication or discovery refusal
- **WHEN** authentication/identity fails or a configured typed entity is missing
- **THEN** the sensor stays disconnected/unknown with a registry reason, sends no
  settings commands and never falls back from configured Noise or password

### Requirement: Connection-scoped reported values
The producer SHALL retain unchanged reported occupancy while connected, label
receipt time independently of sample age, and clear live values after restart
or disconnect. Old-connection callbacks SHALL have no effect.

#### Scenario: Quiet stationary report
- **WHEN** a connected source suppresses equal states for a day
- **THEN** reported occupancy remains available with the same receipt time and
  no claim of continuously verified physical freshness

#### Scenario: Disconnect and restart
- **WHEN** one sensor disconnects or the runtime restarts
- **THEN** affected live values are unknown, retired callbacks cannot revive
  them and another connected sensor remains usable

### Requirement: Honest anonymous approximate points
A point SHALL require finite nonzero-pair X/Y and Active from the same connection
with interpretable tracking settings. Inactive, missing, disabled, invalid or
known masked reports SHALL clear usable axes, requiring both axes again. Held
or unknown hold state SHALL remain explicitly labelled, without identity inference.

#### Scenario: Lost target reactivates
- **WHEN** Active becomes false and then true before fresh X and Y reports
- **THEN** no point reappears until both axes have been reported after the reset

#### Scenario: Invalid or held source
- **WHEN** coordinates are missing/nonfinite, detail is disabled, a point is masked
  or assumed presence is reported
- **THEN** invalid/masked/disabled coordinates yield no point and held points keep
  their independent held label, never a fresh measured-frame claim

### Requirement: Saved calibration and existing private readers
The producer SHALL normalize stock millimeters once and apply the saved sensor
yaw/translation to apartment XZ meters, keeping calibration/mapping revisions.
Existing authenticated SDK/state/history SHALL expose the records best-effort.

#### Scenario: Synthetic transform and moved sensor
- **WHEN** raw (1000,2000) mm uses translation (2,3) meters and yaw pi/2
- **THEN** the approximate apartment point is (4,2), and a changed saved placement
  restarts unknown and recomputes under its new calibration revision

#### Scenario: Authenticated history and a gap
- **WHEN** an authorized read client requests the family, SDK sync and history
- **THEN** it receives current per-sensor reports and retained changes, with a
  disconnect represented as unknown and lost observations never reconstructed as absence
