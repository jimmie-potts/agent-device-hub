## MODIFIED Requirements

### Requirement: Hub-owned weekly power schedules
The Hub SHALL own private routine definitions, timing and dispatch. A routine SHALL name selected weekdays, one local time, a bounded display name, an enabled state and an ordered list of one to sixteen actions, each naming one explicitly configured device, one tracked command family that the device's module declares (`power-set`, `brightness-set`, `scene-activate`, `media-start`, `media-control`, `device-mode-set`, `pixoo-media-show` or `lifx-color-set`), that family's payload with exactly its fields and, optionally for any action, the Hub mode (`work`, `free` or `quiet`) the device must report as its desired mode for the action to run. It SHALL contain no network address, credential, raw protocol action or per-rule timezone, and SHALL add no device command kind. The initial scope SHALL use the Hub host's existing local clock. Creation without explicit enabling SHALL leave the routine disabled. Editing a definition SHALL preserve its enabled state; enable/disable SHALL be separate explicit actions. Definitions SHALL survive supported runtime restarts. Retained one-window power schedules (`power-window/1.0`) SHALL be migrated once at the core's first open, every row in one transaction, each into an on routine that keeps the row's id, definition identity and occurrence guard with a `power-set on` action and an off routine with a new id, a copy of the guard and a `power-set off` action; the added rows are outside the rule limit. Every replacement SHALL be read back through the routine reader before anything is written, and a row the migration cannot read, or a replacement the reader would refuse, SHALL refuse the open and leave every row unchanged.

#### Scenario: Independent schedules
- **WHEN** the owner saves two valid routines for different configured devices
- **THEN** their days, times, actions and enabled states remain independently editable and changing one does not change the other

#### Scenario: Invalid or unsupported target
- **WHEN** a definition has an unknown field, an unconfigured target, a family the target's module does not declare, a payload with missing or extra fields, no actions or more than sixteen, an invalid or repeated weekday, an invalid time, or a mode precondition naming a value other than `work`, `free` or `quiet`
- **THEN** it is refused before storage or device dispatch with the existing shared error shape

#### Scenario: A power window becomes two routines
- **WHEN** the core opens a store that holds a `power-window/1.0` row with an occurrence guard
- **THEN** it holds an on routine with the row's id, identity, guard and enabled state and an off routine with its own id and the copied guard, each with one power action at the window's time, each name valid display text within the bound, and every event rule and log row is unchanged

#### Scenario: One window of several cannot be read
- **WHEN** the core opens a store holding a readable `power-window/1.0` row and one it cannot read
- **THEN** the open is refused and neither row is changed

### Requirement: Capability-based dispatch through existing owners
A due occurrence, or an explicit Run now, SHALL run the routine's actions in order, each through the existing core tracked dispatcher and the current owning module's guarded command, with fresh request identity and applicable configuration/generation guards taken from device evidence read through the established SDK path immediately before that action. An action with a mode precondition SHALL be skipped and logged `blocked` with reason `mode` when the device's desired mode, as its record reports it, is not the required mode or a `device-mode-set` is pending. No action SHALL carry `requireMode`; the owning module's own admission, such as the Pixoo's refusal of playback starts in Work, remains decisive. A scheduled action whose turn comes after the occurrence's 60-second tolerance SHALL be logged `blocked` with reason `expired` and not dispatched. No action waits for an earlier action's outcome. The scheduler SHALL neither import a device transport nor call any physical device directly. A refused, failed, skipped or uncertain action SHALL NOT stop the next action and SHALL NOT be retried, rolled back or deferred. Only an explicit `device-mode-set` action the owner put in the routine may change a device's mode. The initial implementation SHALL be verifiable with generic synthetic targets and the simulated Pixoo and LIFX devices. A routine is standing authorization only for its named actions; module admission, unavailable state and uncertain-write holds SHALL remain decisive.

#### Scenario: A due on and off boundary
- **WHEN** a migrated on routine and its off routine reach their minutes while the target is qualified and available
- **THEN** each submits at most one guarded power command to that target's existing owner and tracks acceptance and outcome separately

#### Scenario: A due occurrence with a skipped content action
- **WHEN** an enabled routine reaches its minute with a Pixoo playlist start that runs only in Free, followed by a LIFX color, while the Pixoo reports Work
- **THEN** the start is logged `blocked` with reason `mode` with no device write, the color action submits one guarded command to the bulb's owner, and the log holds both rows in action order

#### Scenario: A content action in a content mode
- **WHEN** the same routine runs while the Pixoo reports Free
- **THEN** the start submits one guarded `media-start` without `requireMode`, the module admits it, and the outcome is tracked separately from the acceptance

#### Scenario: A Nanoleaf scene in Free
- **WHEN** a routine with a `scene-activate` action that runs only in Free runs while the Nanoleaf's desired mode is `free`
- **THEN** the scene submits one guarded command to the Nanoleaf's owner, and while the Nanoleaf reports Work or Quiet the same action is logged `blocked` with reason `mode` with no device write

#### Scenario: A device is unavailable or held
- **WHEN** an action is due but current device evidence is missing, unavailable, externally controlled or held
- **THEN** no transport call bypasses admission, that action is logged `blocked`, and the next action still runs
