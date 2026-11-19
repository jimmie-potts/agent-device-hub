## MODIFIED Requirements

### Requirement: Consume only fresh live automatic opportunities

Automatic expression SHALL default off and use core-owned first-live coding notice/attention and SDK session/mode copies. An opportunity SHALL match its session through the contracts package's opportunity match: the same generation, identity and turn, and the attention item still present or the notice still present and not acknowledged by `microduck`. No session-count rule and no session freshness or restart term SHALL apply. Validated origins SHALL be durably consumed before suppression. Automatic/manual cue spacing SHALL be 30/two seconds, excluding neutral and local controls. The module SHALL allow one active program, no manual queue and one latest automatic candidate with original five-second expiry. Quiet and control fences SHALL discard pending work without catch-up.

#### Scenario: Re-enable after suppression
- **WHEN** an opportunity suppressed while off, Quiet, stale or busy is redelivered after enable/resume or restart
- **THEN** it produces no replayed gesture

#### Scenario: Multiple sessions
- **WHEN** an opportunity matches one session while other sessions are present
- **THEN** the gesture for that opportunity is selected, and an opportunity whose generation, attention item or notice no longer matches is not
