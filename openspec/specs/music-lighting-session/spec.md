# music-lighting-session Specification

## Purpose
Own explicit Music lighting sessions per light in the core: admit Start and Stop against the active Music capture, send tracked work to the light's own module, and record each ending truthfully without resending or resuming.

## Requirements

### Requirement: Explicit core-owned Music lighting sessions

The core SHALL own one Music lighting session record per qualified Nanoleaf target. A session SHALL start only from an explicit operator Start that names the target, the current revision, a saved reactive preset and the core's current active Music capture endpoint and generation. The core SHALL refuse a Start for a microphone session, a mismatched or inactive capture, a non-idle record or a stale revision, without sending device work. An accepted Start SHALL save a new session generation and send one tracked work request to the light's own module. The core SHALL never change a light's mode to admit music.

#### Scenario: Accepted Start
- **WHEN** an operator starts an idle Nanoleaf target with the current revision, an existing preset name and the active Music capture
- **THEN** the core saves `starting` with a new generation, completes the operator command as observed, and sends exactly one work start carrying that generation

#### Scenario: Refused Start
- **WHEN** the capture is inactive, belongs to the microphone, names another endpoint or generation, the revision is stale or the record is not idle
- **THEN** the core refuses with `unavailable`, `unsupported-capability`, `revision-conflict` or `invalid-state` and sends no work

### Requirement: Truthful endings without automatic resume

The core SHALL follow the light module's session record through sync and record each ending for the current generation. The record SHALL show the reason (stopped, alert, manual, source lost, device, restart, expired or refused) and whether the current base was restored, skipped or not attempted. Records for another generation SHALL NOT change the session. No ending, capture restart, reconnection or core restart SHALL send work again or resume a session; a new session SHALL need a new explicit Start with a new generation.

#### Scenario: Interruption ends the session
- **WHEN** the module reports the current session ended by an alert, a manual change or source loss
- **THEN** the record becomes idle with that ending, and no later work is sent even if capture becomes active again

#### Scenario: Lost answers and restart
- **WHEN** a work answer is lost, or the core restarts during a session
- **THEN** the record becomes uncertain without resending, and the next fresh device record decides whether it is active or ended

#### Scenario: Start the module never held
- **WHEN** a Start's answer is lost and the module never reports or accepts its generation before the work's outcome deadline
- **THEN** the record becomes idle as expired, or refused with the refusal code, and nothing is resent

#### Scenario: Explicit Stop
- **WHEN** an operator stops a starting, active, uncertain or stopping session
- **THEN** the core saves `stopping`, sends one work stop for that generation, and records the module's reported ending

### Requirement: Playing input loss appears in private diagnostics

When a playing session ends for loss of its input, the worker SHALL report the first locally observed retirement cause and bounded last accepted evidence if available. This SHALL preserve the existing ending, restoration and permanent retirement.

#### Scenario: Different losses have the same safe ending

- **WHEN** a synthetic missing-feature expiry or subscription overflow ends a playing session
- **THEN** diagnostics distinguish the observed local condition while both cases follow the existing source-loss ending and restoration rules

### Requirement: Explicit saved show start in Audio

Audio SHALL let a control user explicitly start an exact immutable saved decorative show version on one qualified Nanoleaf light from position zero with no requested delay. It SHALL identify the selected saved version and target separately from live Music.app lighting. Unsaved drafts and the storyboard SHALL remain outside playback. Existing tracked outcomes SHALL distinguish the core request from the module's result, and Stop SHALL use the active generation.

#### Scenario: Play an earlier saved version

- **WHEN** the operator chooses an exact saved version for one idle light and selects Start saved show
- **THEN** one tracked request carries the selected version and light's current revision, and a newer saved version does not replace the selection

#### Scenario: Unavailable evidence and passive page activity

- **WHEN** status or the show catalog is stale, control is unavailable, or a request is pending
- **THEN** Audio disables Start saved show
- **AND** navigation, edit, save, refresh and reconnect issue no playback command or retry

#### Scenario: Admission refusal and Stop

- **WHEN** the worker refuses admission or the operator stops an admitted show
- **THEN** Audio presents the tracked result and only explicitly requested Stop can send a generation-bound Stop

### Requirement: Admit measured shows with verified playback

Measured playback SHALL require an explicit start for one light in Free mode, an immutable saved show version, and fresh evidence tying playback of the scoped Music item to the show timeline. A mismatch, unsupported alignment, or stale evidence SHALL prevent the light from starting and return the applicable shared refusal. The session SHALL honor manual takeover, alert, Stop, and source loss under the existing restoration policy. Reconnect or restart SHALL send no Start and replay no cues.

#### Scenario: Different item with matching display metadata

- **WHEN** a requested measured show has the same displayed song and artist as playback but the scoped Music item does not match
- **THEN** the start is refused and the device is not addressed

#### Scenario: Another source takes over

- **WHEN** a running measured show loses its qualified playback source
- **THEN** the show ends under the existing restoration policy and does not restart on later evidence

### Requirement: A single missed NL22 playback status check holds frames

During live Music or saved-show playback on NL22 Light Panels, the module SHALL withhold datagrams after a scheduled ownership read exceeds its deadline. It SHALL use the existing check cadence and require a complete check before sending a current frame. Show position, cue accounting and source expiry SHALL continue under their existing clocks and rules. This behavior applies to NL22 playback status deadlines only.

#### Scenario: The next scheduled check confirms ownership

- **WHEN** one ownership check reaches its deadline and the next scheduled check confirms the light still shows the same stream under the existing ownership guard
- **THEN** rendering continues with current frames, without backfill or a second streaming entry, and a later deadline gets the same one-check allowance

#### Scenario: Consecutive misses or confirmed takeover

- **WHEN** the next check also misses its deadline while the session still owns playback, or a check confirms a manual change
- **THEN** the affected session ends as `device` with `unavailable` for consecutive misses or `manual` for takeover, both without restoration

#### Scenario: An ending becomes due while frames are held

- **WHEN** Stop, alert, source loss, show completion or a newer choice ends the session during the hold
- **THEN** the pending ending retains its existing priority and restoration guard, and no playback frames resume

#### Scenario: A failure outside the allowance

- **WHEN** Lines misses a playback status check, or an NL22 ownership read fails for a reason other than a deadline
- **THEN** the existing immediate device failure applies
