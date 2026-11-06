## ADDED Requirements

### Requirement: Live Music sessions on Lines through the existing writer

The Nanoleaf module SHALL accept Music lighting work only from the core. It SHALL admit a Start only on the Lines device in Free with no pending mode, no hold, no other live session or waiting content, an existing frozen preset that the renderer accepts, and a current named Free scene with readable brightness as the base. A refused Start SHALL make no device write and SHALL NOT change mode. An admitted session SHALL render only the newest fresh Music feature for its capture binding inside the device's locked worker, with at most one write in flight, at most one write per 100 ms and no catch-up.

#### Scenario: Admission outside the first trial
- **WHEN** work asks to start on Panels, in Work or Quiet, while held, without a named Free scene, with an unknown preset or from a source other than the core
- **THEN** the module refuses before any device write or mode change

#### Scenario: Paced latest-value rendering
- **WHEN** features arrive faster than ten per second, repeat a sequence, are stale or belong to another generation
- **THEN** only the newest fresh feature is rendered, duplicates and stale or foreign features produce no write, and valid silence keeps the session playing

### Requirement: Interruption, Stop and current-base return

A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write, and its record SHALL name that reason. Stop and alert endings SHALL restore the Free base only while the device still shows the music effect, the base is still listed, brightness is unchanged and no newer change exists before and after each write; otherwise restoration is skipped. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay.

#### Scenario: Newer manual change wins
- **WHEN** a scene, brightness, power, mode or moment request arrives during a session, or during its restoration
- **THEN** the session ends as manual and no music or restoration write follows the newer change

#### Scenario: Alert and source loss
- **WHEN** an alert indication appears, or the input expires, reports discontinuity or overflows
- **THEN** the session ends with that reason, the guarded base restoration runs, and the microphone is never selected

#### Scenario: Restart
- **WHEN** the module starts with a session still starting or playing
- **THEN** that session ends as restart with no device write
