## ADDED Requirements

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

#### Scenario: Explicit Stop
- **WHEN** an operator stops a starting, active or uncertain session
- **THEN** the core saves `stopping`, sends one work stop for that generation, and records the module's reported ending
