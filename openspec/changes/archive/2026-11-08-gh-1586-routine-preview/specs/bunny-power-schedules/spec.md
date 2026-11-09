## ADDED Requirements

### Requirement: Read-only routine preview
The Hub SHALL answer a preview of one saved routine from its current records, applying to each action the same guard function a run applies before its send. Each action SHALL answer `would-send`, or `blocked` with the reason a run would log (`unavailable`, `mode` or `busy`) and the failing guard from a closed list (`not-configured`, `no-evidence`, `stale`, `not-available`, `held`, `unsupported`, `external`, `pending-mode`, `mode-unknown`, `wrong-mode`, `in-flight`). A preview SHALL send no command and write no automation-log row, SHALL claim and schedule no occurrence, and SHALL leave the routine's in-flight state unchanged. A failed read SHALL yield that action's `no-evidence`, not a failed preview. The gateway SHALL serve it as `GET /api/v2/automation/routines/<id>/preview` under read scope, as an `automation/2.0` reply with the routine id, the reading time, the enabled state, any next occurrence and the per-action verdicts. It SHALL refuse an unknown routine with the shared `not-found` body and absent routines with `unavailable`. The Automation page SHALL offer Preview beside Run now, check the reply's declared shape, show the result inline with its reading time and a note that a real run checks again, and clear it on the next refresh or edit.

#### Scenario: Preview names the run's reasons without an effect
- **WHEN** a reader previews a saved routine that starts a Pixoo playlist and paints a LIFX bulb while the Pixoo shows Monitor
- **THEN** the playlist action is `blocked` with reason `mode` and detail `wrong-mode`, the color action is `would-send`, no command is admitted and no automation-log row is written
- **AND** a following Run now logs the playlist action `blocked` with reason `mode` and sends the color action

#### Scenario: Each guard matches the run
- **WHEN** an action's target is unconfigured, has no or stale evidence, is unavailable, held, externally controlled or lacks the family, or its required mode is unknown, different or pending
- **THEN** the preview's reason equals the reason a run then logs for the same records, its detail names that guard, and the next action is evaluated on its own

#### Scenario: An occurrence is in flight
- **WHEN** a routine is previewed while one of its occurrences is still dispatching
- **THEN** every action answers `blocked` with reason `busy` and detail `in-flight`, and the running occurrence gains no send and keeps its in-flight state

#### Scenario: Preview refusals
- **WHEN** a preview names an unknown routine, comes from a caller without read authority, or arrives while routines are unavailable
- **THEN** the gateway answers `not-found`, the existing authority refusal or `unavailable` in the shared error body, and nothing is logged or sent
