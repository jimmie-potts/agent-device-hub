## MODIFIED Requirements

### Requirement: Music input is fresh latest-value data within one binding

Music feature intake SHALL validate the existing profile-2 capture family, producer source, endpoint and generation, retain at most one immutable feature, and accept only increasing sequence and source time. It SHALL judge freshness from the payload's original validity and a receiver-local monotonic deadline, without comparing absolute remote and local monotonic clocks. Duplicate or invalid input SHALL NOT extend freshness. A producer discontinuity marker on a window that follows the previous accepted window in source time, such as after a missed window, SHALL NOT retire the input: the window becomes the latest feature and effect timing continues across the gap from source-time differences. Expiry, source time that runs backwards, clock invalidity or explicit retirement SHALL require a new input instance; no late frame SHALL reactivate the retired instance.

#### Scenario: Fresh envelope cannot refresh old observations
- **WHEN** a duplicate, reverse-sequence or already expired feature arrives in a new envelope
- **THEN** it cannot replace or refresh the latest feature, and the slot is unavailable at its original expiry boundary

#### Scenario: Independent clocks
- **WHEN** source monotonic timestamps have a different origin from receiver monotonic time
- **THEN** freshness still follows payload wall validity and the local receipt deadline, while effect timing follows source-time differences only

#### Scenario: Retirement and discontinuity
- **WHEN** source time reverses (a discontinuity that runs backwards), the receiver monotonic clock moves backward or drifts beyond the shared tolerance, freshness expires, or the caller retires the input
- **THEN** no subsequent frame from that instance is available, even if later messages appear fresh

#### Scenario: Missed window
- **WHEN** a valid bound feature after initialization reports the producer's discontinuity marker and starts after the previous accepted window ends
- **THEN** it becomes the latest fresh feature, the input stays available, and rendering continues with the elapsed source time across the gap, as for an ordinary sequence gap

#### Scenario: Input bursts
- **WHEN** multiple increasing valid features arrive before consumption, including sequence gaps
- **THEN** only the newest feature is available and missing windows produce no replay queue or synthesized beat

#### Scenario: Initial native window
- **WHEN** the first accepted window of a new binding has the native producer's initial discontinuity marker
- **THEN** it initializes fresh effect state without carrying earlier capture history

### Requirement: Interruption, Stop and current-base return

Before each frame write the module SHALL confirm that the device still shows the music frame's selection. A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write, and its record SHALL name that reason. Stop and alert endings SHALL restore the Free base only while the device still shows the music effect, the base is still listed, brightness is unchanged and no newer change exists before and after each write, and the light is on; otherwise restoration is skipped, or uncertain when a write's answer was lost. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay.

#### Scenario: Newer manual change wins
- **WHEN** a scene, brightness, power, mode or moment request arrives during a session, or during its restoration
- **THEN** the session ends as manual and no music or restoration write follows the newer change

#### Scenario: Alert and source loss
- **WHEN** an alert indication appears, or the input expires, is retired or overflows
- **THEN** the session ends with that reason, the guarded base restoration runs, and the microphone is never selected

#### Scenario: A missed window is not source loss
- **WHEN** one capture window is missing and the next carries the producer's discontinuity marker while features stay fresh
- **THEN** the session keeps playing, and it ends as source loss only once no fresh feature remains

#### Scenario: Restart
- **WHEN** the module starts with a session still starting or playing
- **THEN** that session ends as restart with no device write
