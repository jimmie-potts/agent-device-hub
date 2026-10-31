# bunny-power-schedules Specification

## Purpose

Let one owner define reusable weekly power schedules in B.U.N.N.Y., independently of each device's protocol and physical writer.

## Requirements

### Requirement: Hub-owned weekly power schedules
The Hub SHALL own private routine definitions, timing and dispatch. A routine SHALL name selected weekdays, one local time, a bounded display name, an enabled state and an ordered list of one to sixteen actions, each naming one explicitly configured device, one tracked command family that the device's module declares (`power-set`, `brightness-set`, `scene-activate`, `media-start`, `media-control`, `device-mode-set`, `pixoo-media-show` or `lifx-color-set`), that family's payload with exactly its fields and, for a content action (`scene-activate`, `media-start`, `media-control`, `pixoo-media-show`), the native content mode of the device's kind that the device must be in: `media` for a Pixoo, `free` for a Nanoleaf, taken when omitted and the only mode such an action may require. Any other action MAY require a mode the device offers, or none. It SHALL contain no network address, credential, raw protocol action or per-rule timezone, and SHALL add no device command kind. The initial scope SHALL use the Hub host's existing local clock. Creation without explicit enabling SHALL leave the routine disabled. Editing a definition SHALL preserve its enabled state; enable/disable SHALL be separate explicit actions. Definitions SHALL survive supported runtime restarts. Retained one-window power schedules (`power-window/1.0`) SHALL be migrated once at the core's first open, every row in one transaction, each into an on routine that keeps the row's id, definition identity and occurrence guard with a `power-set on` action and an off routine with a new id, a copy of the guard and a `power-set off` action; the added rows are outside the rule limit. Every replacement SHALL be read back through the routine reader before anything is written, and a row the migration cannot read, or a replacement the reader would refuse, SHALL refuse the open and leave every row unchanged.

#### Scenario: Independent schedules
- **WHEN** the owner saves two valid routines for different configured devices
- **THEN** their days, times, actions and enabled states remain independently editable and changing one does not change the other

#### Scenario: Invalid or unsupported target
- **WHEN** a definition has an unknown field, an unconfigured target, a family the target's module does not declare, a payload with missing or extra fields, no actions or more than sixteen, an invalid or repeated weekday, an invalid time, a content action whose target kind has no content mode, or a content action that requires any mode other than its kind's content mode
- **THEN** it is refused before storage or device dispatch with the existing shared error shape

#### Scenario: A power window becomes two routines
- **WHEN** the core opens a store that holds a `power-window/1.0` row with an occurrence guard
- **THEN** it holds an on routine with the row's id, identity, guard and enabled state and an off routine with its own id and the copied guard, each with one power action at the window's time, each name valid display text within the bound, and every event rule and log row is unchanged

#### Scenario: One window of several cannot be read
- **WHEN** the core opens a store holding a readable `power-window/1.0` row and one it cannot read
- **THEN** the open is refused and neither row is changed

### Requirement: Capability-based dispatch through existing owners
A due occurrence, or an explicit Run now, SHALL run the routine's actions in order, each through the existing core tracked dispatcher and the current owning module's guarded command, with fresh request identity and applicable configuration/generation guards taken from device evidence read through the established SDK path immediately before that action. A content action SHALL be skipped and logged `blocked` with reason `mode` when the device's desired mode is not the required mode or a `device-mode-set` is pending, and a mode-checked family (`media-start`, `media-control`, `pixoo-media-show`) SHALL carry `requireMode` so the owning module refuses it again at admission. A scheduled action whose turn comes after the occurrence's 60-second tolerance SHALL be logged `blocked` with reason `expired` and not dispatched. No action waits for an earlier action's outcome. The scheduler SHALL neither import a device transport nor call any physical device directly. A refused, failed, skipped or uncertain action SHALL NOT stop the next action and SHALL NOT be retried, rolled back or deferred. Only an explicit `device-mode-set` action the owner put in the routine may change a device's mode. The initial implementation SHALL be verifiable with generic synthetic targets and the simulated Pixoo and LIFX devices. A routine is standing authorization only for its named actions; module admission, unavailable state and uncertain-write holds SHALL remain decisive.

#### Scenario: A due on and off boundary
- **WHEN** a migrated on routine and its off routine reach their minutes while the target is qualified and available
- **THEN** each submits at most one guarded power command to that target's existing owner and tracks acceptance and outcome separately

#### Scenario: A due occurrence with a skipped content action
- **WHEN** an enabled routine reaches its minute with a Pixoo playlist start followed by a LIFX color while the Pixoo shows Monitor
- **THEN** the start is logged `blocked` with reason `mode` with no device write, the color action submits one guarded command to the bulb's owner, and the log holds both rows in action order

#### Scenario: A content action in a content mode
- **WHEN** the same routine runs while the Pixoo shows Media
- **THEN** the start submits one guarded `media-start` carrying `requireMode: "media"`, the module admits it, and the outcome is tracked separately from the acceptance

#### Scenario: A Nanoleaf scene in Free
- **WHEN** a routine with a `scene-activate` action runs while the Nanoleaf's desired mode is `free`
- **THEN** the scene submits one guarded command to the Nanoleaf's owner, and while the Nanoleaf shows status the same action is logged `blocked` with reason `mode` with no device write

#### Scenario: A device is unavailable or held
- **WHEN** an action is due but current device evidence is missing, unavailable, externally controlled or held
- **THEN** no transport call bypasses admission, that action is logged `blocked`, and the next action still runs

### Requirement: Future-only scheduling and duplicate suppression
The Hub SHALL persist definitions and minimal duplicate guards, never a replayable command queue. Startup and reconnect SHALL schedule future occurrences only, with no catch-up, resumed command or missed-run-history reconstruction. A repeated occurrence SHALL cause no second dispatch. Disabled or deleted definitions and obsolete callbacks after edits SHALL cause no dispatch, and an edit, disable or delete while an occurrence runs SHALL stop its remaining actions. Saving or enabling a routine SHALL not run it. One occurrence per routine SHALL run at a time: an occurrence or Run now that overlaps a running one SHALL be logged `blocked` with reason `busy` and dropped. The implementation SHALL use the host's local clock without a timezone library, per-rule zone selector or custom DST rules.

#### Scenario: A pending boundary is changed
- **WHEN** the owner disables, deletes or edits a routine before a waiting callback dispatches, including while a device read is pending
- **THEN** the obsolete callback sends nothing and only the current enabled definition can schedule later work

#### Scenario: Restart after the minute
- **WHEN** the Hub restarts after a routine's minute
- **THEN** it sends nothing for that occurrence and schedules only the next future occurrence

#### Scenario: Same occurrence is presented twice
- **WHEN** the same saved occurrence is offered twice or the runtime recovers after recording its dispatch intent
- **THEN** it is never sent twice and the restarted owner does not replay its commands

#### Scenario: An overlapping occurrence
- **WHEN** Run now is requested while the routine's previous occurrence is still dispatching
- **THEN** one `blocked` row with reason `busy` is logged, nothing is queued, and the running occurrence completes its remaining actions

### Requirement: Manual control and maximum-on boundary
Manual control SHALL remain available through the existing device path. A manual change SHALL persist until another explicit command, the next enabled routine action or an independently enabled device maximum-on limit. The scheduler SHALL not continuously enforce a state or restart a device merely because a change occurred between occurrences. An optional maximum-on feature SHALL remain separate from the routine definition and does not gain qualification from scheduling tests.

#### Scenario: A lamp turns off between occurrences
- **WHEN** a person or the device's independent maximum-on limit turns a lamp off after a routine switched it on
- **THEN** the scheduler sends no automatic re-on and leaves the next future occurrence intact

### Requirement: Authenticated shared management and truthful observations
The shared Automation page SHALL provide create/edit/delete, independent enable/disable and an explicit Run now for weekly routines, with configured target selection, the families each target declares, each family's fields, the per-action required mode and the Hub-local clock basis. Reads SHALL require existing read authority; mutations and Run now SHALL recheck existing control authority, origin and unsafe-request header after reading their bounded body and before storage or dispatch. Run now SHALL submit one occurrence and answer once each action's dispatch has answered, so the existing log shows its rows. The page SHALL distinguish a saved definition, next occurrence, each action's attempted command/receipt, skip or refusal, terminal outcome and observed device state. It SHALL use the shared authenticated Hub path and contain no scheduler or device credentials. A lost mutation reply SHALL not be retried automatically.

#### Scenario: Browser or caller has no control authority
- **WHEN** a read-only or revoked client tries to create, edit, delete, enable, disable or run a routine
- **THEN** no routine changes or device commands occur and the existing fixed shared refusal is returned

#### Scenario: Accepted is not observed
- **WHEN** an action's command is accepted but its outcome or device observation is absent or uncertain
- **THEN** the page retains that distinction and does not show the device as freshly changed from the acceptance alone

### Requirement: Honest operating limits and compatibility
Weekly routines SHALL require the Hub to run and the selected target paths to be available. No offline, installed or physical guarantee SHALL be inferred from source/simulated success. Source delivery SHALL keep routines inactive in the established installation until the owning procedure verifies the actual releases and assesses the routine storage change, including the one forward migration, with focused evidence. Existing event rules, settings and log entries SHALL retain their behavior and data.

#### Scenario: Hub was down at a minute
- **WHEN** the Hub was not running at a routine's minute
- **THEN** it performs no retrospective device action and the user is not told that the missed actions succeeded

#### Scenario: Runtime recovery retains routine data
- **WHEN** recovery is proposed after routine definitions exist
- **THEN** that operation needs compatibility evidence for those actual definitions and occurrence guards; an older release, which reads neither `routine/1.0` rows nor the migrated windows, is not assumed compatible
