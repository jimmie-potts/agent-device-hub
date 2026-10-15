## Purpose

Let one owner define reusable weekly power schedules in B.U.N.N.Y., independently of each device's protocol and physical writer.

## ADDED Requirements

### Requirement: Hub-owned weekly power schedules
The Hub SHALL own private schedule definitions, timing and dispatch. A schedule SHALL name one explicitly configured device, selected weekdays, one local on time, one later local off time, a bounded display name and an enabled state. It SHALL contain no network address, credential, raw protocol action or per-rule timezone. The initial scope SHALL use same-day windows and the Hub host's existing local clock. Creation without explicit enabling SHALL leave the schedule disabled. Editing a definition SHALL preserve its enabled state; enable/disable SHALL be separate explicit actions. Definitions SHALL survive supported runtime restarts.

#### Scenario: Independent schedules
- **WHEN** the owner saves two valid schedules for different configured power-capable devices
- **THEN** their days, times and enabled states remain independently editable and changing one does not change the other

#### Scenario: Invalid or unsupported target
- **WHEN** a definition has an unknown field, unconfigured target, unsupported power capability, invalid or repeated weekday, invalid time, or an end no later than its start
- **THEN** it is refused before storage or device dispatch with the existing shared error shape

### Requirement: Capability-based dispatch through existing owners
A due boundary SHALL use the existing core tracked dispatcher and the current owning module's guarded power command. The scheduler SHALL read current device evidence through the established SDK path and supply fresh request identity and applicable configuration/generation guards. It SHALL neither import a Wemo transport nor call any physical device directly. The initial implementation SHALL be verifiable with generic synthetic power-capable targets without activating another real device. A schedule is standing authorization only for its named actions; module admission, unavailable state and uncertain-write holds SHALL remain decisive.

#### Scenario: A due on and off boundary
- **WHEN** an enabled schedule reaches an on boundary and later an off boundary while its target is qualified and available
- **THEN** each boundary submits at most one guarded power command to that target's existing owner and tracks acceptance and outcome separately

#### Scenario: A device is unavailable or held
- **WHEN** a boundary is due but current device evidence is missing, unavailable, externally controlled or held
- **THEN** no transport call bypasses admission and the attempted result remains a refusal, failure or uncertainty rather than observed success

### Requirement: Future-only scheduling and duplicate suppression
The Hub SHALL persist definitions and minimal duplicate guards, never a replayable command queue. Startup and reconnect SHALL schedule future occurrences only, with no catch-up, resumed command or missed-run-history reconstruction. A repeated occurrence SHALL cause no second dispatch. Disabled or deleted definitions and obsolete callbacks after edits SHALL cause no dispatch. Saving or enabling a schedule SHALL not immediately turn the device on to match an already active window. The implementation SHALL use the host's local clock without a timezone library, per-rule zone selector or custom DST rules.

#### Scenario: Restart during an active window
- **WHEN** the Hub restarts after the on boundary and before the future off boundary
- **THEN** it sends no catch-up on command and schedules only the future off boundary and later occurrences

#### Scenario: A pending boundary is changed
- **WHEN** the owner disables, deletes or edits a schedule before a waiting callback dispatches, including while a device read is pending
- **THEN** the obsolete callback sends nothing and only the current enabled definition can schedule later work

#### Scenario: Same occurrence is presented twice
- **WHEN** the same saved schedule boundary is offered twice or the runtime recovers after recording its dispatch intent
- **THEN** it is never sent twice and the restarted owner does not replay its command

### Requirement: Manual control and maximum-on boundary
Manual control SHALL remain available through the existing device path. A manual change SHALL persist until another explicit command, the next enabled schedule boundary or an independently enabled device maximum-on limit. The scheduler SHALL not continuously enforce an on window or restart a device merely because an off occurred within that window. An optional maximum-on feature SHALL remain separate from the schedule definition and does not gain qualification from scheduling tests.

#### Scenario: A lamp turns off before the scheduled end
- **WHEN** a person or the device's independent maximum-on limit turns a lamp off during its weekly on window
- **THEN** the scheduler sends no automatic re-on for that window and leaves the next future scheduled boundary intact

### Requirement: Authenticated shared management and truthful observations
The shared Automation page SHALL provide create/edit/delete and independent enable/disable for weekly power schedules, configured target selection and the Hub-local clock basis. Reads SHALL require existing read authority; mutations SHALL recheck existing control authority, origin and unsafe-request header after reading their bounded body and before storage. The page SHALL distinguish a saved definition, next occurrence, attempted command/receipt, terminal outcome and observed power. It SHALL use the shared authenticated Hub path and contain no scheduler or device credentials. A lost mutation reply SHALL not be retried automatically.

#### Scenario: Browser or caller has no control authority
- **WHEN** a read-only or revoked client tries to create, edit, delete, enable or disable a schedule
- **THEN** no schedule changes or device commands occur and the existing fixed shared refusal is returned

#### Scenario: Accepted is not observed
- **WHEN** a scheduled command is accepted but its outcome or device observation is absent or uncertain
- **THEN** the page retains that distinction and does not show the lamp as freshly on or off from the acceptance alone

### Requirement: Honest operating limits and compatibility
Weekly schedules SHALL require the Hub to run and the selected target path to be available. No offline, installed or physical guarantee SHALL be inferred from source/simulated success. Source delivery SHALL keep schedules inactive in the established installation until the installation procedure admits the actual releases and their schedule state/recovery compatibility. Existing event rules, settings and log entries SHALL retain their behavior and data.

#### Scenario: Hub was down at a boundary
- **WHEN** the Hub was not running at an on or off boundary
- **THEN** it performs no retrospective device action and the user is not told that the missed action succeeded

#### Scenario: Runtime recovery retains new schedule data
- **WHEN** an installed upgrade or recovery is proposed after schedule definitions exist
- **THEN** that operation needs compatibility evidence for those actual definitions and duplicate guards; an older release's event-only reader is not assumed compatible
