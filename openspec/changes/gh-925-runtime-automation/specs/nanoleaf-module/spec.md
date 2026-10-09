## MODIFIED Requirements

### Requirement: Nanoleaf commands and outcomes

The module SHALL answer, on each device's own keys, `device-mode-set` (Work, Quiet and Free), `power-set`, `brightness-set` and `scene-activate`, answer bounded `moment-play` on Lines, refuse `zone-power-set`, `media-start` and `media-control` with `unsupported-capability`, and answer its own families: wall edits, machine edits, animation play, favorite edits and notice acknowledgment. It SHALL refuse a stale `expectedConfigurationRevision` or `expectedGeneration` with `revision-conflict` and a command `commandSupported` rejects with `unsupported-capability`, before anything changes. Admission SHALL keep the port's domain checks: requested scenes and animations play in Free only, bounded moments also play in Work, animations on the Lines only, one waiting animation, 32 waiting native commands, `validFavoriteEdit` and the effect rules. Each admission SHALL run inside the module's outbox transaction, so an accepted command's journal row commits before its `accepted` reply, and a refusal or a store failure rolls back and is the reply: a store that is full, told by the `SQLITE_FULL` or `ENOSPC` code on the error or a cause that wraps it and never by its text, SHALL be refused with `capacity`, and any other store failure with `internal`, which the module logs once with the error's type; no record SHALL carry the error's text. Each accepted command SHALL end with exactly one outcome through the outbox, in the command's trace, with the registry's error detail: `succeeded` with transmitted or observed evidence, `failed`, or `uncertain`. A mode is the module's own state: a `device-mode-set` SHALL commit its mode, ending the device's queued work, its hold and its overrides, and complete `succeeded` with evidence `observed` in its admission's transaction, whether or not the device answers; nothing is sent to the device as part of it, so it has no expiry, and the worker paints the mode as the module's state once the device answers, as the device's availability shows. Power, brightness, scenes and animations are device writes. A write whose answer did not come SHALL end `uncertain`, hold the device until an explicit mode command or a fresh control, and SHALL NOT be retried. A device that answers a write with an HTTP error status heard it: the command SHALL fail with evidence `transmitted` and the status's code (401 `unauthenticated`, 403 `forbidden`, 404 `not-found`, 409 `invalid-state`, 429 `capacity`, 5xx `unavailable`, any other `invalid-request`), and nothing SHALL hold the device. A device write still queued at its expiry SHALL fail `expired`, whether or not a worker runs, and SHALL hold nothing, since it proves no effect. A power or brightness command that fails SHALL take its desired value with it unless another of its kind still waits. At a restart, each command accepted before it with no outcome SHALL end and never run: an attempt without a result is uncertain, as is an acknowledgment whose request may have reached the core, and a queued command or a waiting machine edit fails `cancelled`. A missing saved layout SHALL refuse an animation or a wall edit that needs it with `invalid-state`, and a refused favorite edit SHALL say what was wrong with the favorite.

The Lines moment capability SHALL advertise the required `celebrate`, `setback` and `reminder` vocabulary and a 10,000 ms maximum duration. Work SHALL admit an interlude only when `coversStatus` carries the owner-approved interrupt permission, and alerts SHALL always preempt. Free SHALL require a currently observed named scene and brightness, and a newer scene, brightness, configuration or mode choice SHALL supersede restoration. Start windows, persistent moment identity and the existing uncertain-write hold SHALL prevent stale effects, replay and automatic retry.

#### Scenario: Work, Quiet and Free
- **WHEN** an operator sets a wall showing a task to Quiet, then Free, then Work
- **THEN** each is accepted and succeeds with evidence `observed` as its mode commits, the Lines dim to the Quiet level, play their saved scene with no indicator write in Free, and show the task again in Work; a mode the device does not advertise is refused with `unsupported-capability`

#### Scenario: Play outside Free
- **WHEN** an animation is asked for in Work, in Quiet and in Free
- **THEN** the first two are refused with `unsupported-capability` and have no outcome, and the third is accepted and succeeds with transmitted evidence

#### Scenario: A moment
- **WHEN** a supported bounded moment is asked of Lines in Work or over a currently observed named Free scene
- **THEN** the single device writer plays it once and restores current Work rendering or the named Free base before completing; the start window, current revision and alert policy are checked before effects

#### Scenario: Unknown Free content
- **WHEN** a moment is asked in Quiet, on panels, or over unknown or unnamed Free content
- **THEN** it is refused with unsupported-capability before effect writes

#### Scenario: A moment is overtaken
- **WHEN** a mode, configuration, alert or explicit content choice overtakes a moment
- **THEN** the current choice takes precedence, stale restoration is not written and the tracked outcome states whether effects were transmitted or uncertain

#### Scenario: Restart during a moment
- **WHEN** the module restarts with a queued or attempted moment
- **THEN** it ends without playing the moment again and preserves the existing uncertain-write hold

#### Scenario: An uncertain write
- **WHEN** a brightness write reaches the device and its answer is lost
- **THEN** the command ends `uncertain` with `uncertain-result`, the device takes no further write, the lost write included, until an explicit mode command, which releases the hold; meanwhile the device record is `degraded`, not `unavailable`, the wall view shows `held`, and the hold is logged once as it begins and once as it ends

#### Scenario: Commands while the wall does not answer
- **WHEN** Quiet and then a brightness write are accepted while the wall does not answer, the write's deadline passes, and the wall answers again
- **THEN** Quiet succeeds with evidence `observed` at once, the brightness write fails `expired` with evidence `none` and takes its desired brightness with it, nothing holds the wall, and once it answers the device is `available`, the wall shows Quiet at Quiet's level, and a new session takes a Line with no other command

#### Scenario: A device that answers with an error
- **WHEN** the wall answers a brightness write with 400, a scene it no longer has with 404, and a power write with 401
- **THEN** each command fails with evidence `transmitted` and `invalid-request`, `not-found` and `unauthenticated`, nothing holds the wall, the next write goes out, and a wall that refuses every request with 401 is `degraded`, not `unavailable`, logged once each way

#### Scenario: A command no worker checks
- **WHEN** another instance holds the device's worker lock and a power command's deadline passes
- **THEN** the command fails `expired` and never reaches the device

#### Scenario: A restart replays nothing
- **WHEN** the module restarts with a comet waiting and a power command queued, while the core does not serve its sessions
- **THEN** the power command fails `cancelled` and is never sent, and no comet or wave is written after the restart

#### Scenario: What a restart ends
- **WHEN** the module restarts while an acknowledgment's request waits at the core, a machine edit waits for a comet, and, in another run, a write's answer has not come
- **THEN** the acknowledgment ends `uncertain`, the machine edit fails `cancelled` and never applies, and the write ends `uncertain` and holds the device, shown as `degraded` and `held` with no failed pass

#### Scenario: A full store at admission
- **WHEN** a wall edit and a machine edit meet a full store, and later a read-only one
- **THEN** each edit on the full store is refused with `capacity`, which the bus records at WARN, with no transaction left open and nothing changed, and both are accepted once there is room; the edit on the read-only store is refused with `internal`, which the module logs once at ERROR with the error's type, and no record holds SQLite's text

