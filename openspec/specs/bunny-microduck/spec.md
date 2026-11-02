# bunny-microduck Specification

## Purpose

Provide truthful simulator-only MicroDuck head expression through the existing B.U.N.N.Y. command owner, with explicit authority, bounded programs and durable uncertainty.

## Requirements

### Requirement: Admit only the witnessed simulator session

The module SHALL admit only the pinned Linux ARM64 robotd/MuJoCo pair selected by #620, with a current private witness binding live processes, actual arguments, namespace, socket, binary, model, policy and disabled-writer configuration. It SHALL refuse physical, remote and discovered targets. Loss of either member SHALL invalidate admission, terminate/reap the survivor and require explicit setup for replacement. Startup, reconnect and dashboard reads SHALL never enable policy or send head inputs.

#### Scenario: Process replacement invalidates admission
- **WHEN** either witnessed process exits, is replaced or loses its bound evidence
- **THEN** controls become unavailable, possible effects become held, both old members are reaped and no automatic restart or motion occurs

#### Scenario: Configuration is not backend proof
- **WHEN** only a simulator flag, socket address or remote-session response is supplied
- **THEN** the target is refused without an actuator effect

### Requirement: Execute only the finite guarded head catalog

The module SHALL expose notice yaw +0.10 rad and attention yaw -0.10 rad, other head inputs zero, one 800 ms outbound phase and one 800 ms zero-input return. Return SHALL send only 800 through 900 ms after the first actual send. Neutral SHALL send zero head input once and confirm two advancing post-send input samples within 0.005 rad by 800 ms. Every stage SHALL retain the original five-second deadline, current configuration/generation/session and fresh healthy balancing-policy evidence. No beak, pose, skills, power, torque, walking or audio control SHALL be exposed.

#### Scenario: A phase becomes late or loses authority
- **WHEN** the return window passes, Quiet begins, takeover changes, a deadline expires or evidence becomes stale after a possible write
- **THEN** no remaining input is sent and the original operation becomes uncertain and held

#### Scenario: Freshness follows sensors
- **WHEN** frames repeat an old sensor timestamp while daemon uptime advances
- **THEN** they do not refresh admission, which requires two advancing losslessly parsed sensor timestamps in the witnessed shared monotonic namespace and age zero through 500 ms

### Requirement: Local Stop and explicit recovery remain independent

Stop expression SHALL commit cancellation of future B.U.N.N.Y. writes and an automatic-expression latch without vendor I/O or fresh vendor evidence. Atomic control epochs SHALL fence stale Resume and every presend boundary without waiting for vendor replies. Enable-auto SHALL not clear a Stop/takeover latch. Explicit neutral recovery SHALL name the exact held request and current guards, retain original uncertainty in history and clear only the matching hold after fresh input-space confirmation. No result SHALL claim physical rest.

#### Scenario: Stop during a missing vendor answer
- **WHEN** the operator selects Stop expression during a pending gesture reply
- **THEN** Stop completes independently, no second input is sent and the gesture retains its uncertain outcome

#### Scenario: Recovery refusal or uncertainty
- **WHEN** recovery has stale guards or loses its answer
- **THEN** refusal preserves the old hold, while new possible effects replace it and require another acknowledgment

### Requirement: Consume only fresh live automatic opportunities

Automatic expression SHALL default off and use core-owned first-live coding notice/attention and SDK session/mode copies. Exactly one fresh eligible session SHALL match, without restart uncertainty. Validated origins SHALL be durably consumed before suppression. Automatic/manual cue spacing SHALL be 30/two seconds, excluding neutral and local controls. The module SHALL allow one active program, no manual queue and one latest automatic candidate with original five-second expiry. Quiet and control fences SHALL discard pending work without catch-up.

#### Scenario: Re-enable after suppression
- **WHEN** an opportunity suppressed while off, Quiet, stale or busy is redelivered after enable/resume or restart
- **THEN** it produces no replayed gesture

#### Scenario: Multiple sessions
- **WHEN** more than one fresh eligible session is present
- **THEN** no automatic gesture is selected

### Requirement: Durable responsibility and truthful outcomes

The module SHALL use profile 2.0, device/2.1, existing SDK/core tracking, registry errors and module-private responsibility/outbox. It SHALL persist before acceptance and possible writes, refuse duplicate/expired/unsupported/unauthorized work before effects, never retry head writes and publish only outcomes after restart. Succeeded/transmitted SHALL describe the accepted input program, not physical pose/rest. Device errors SHALL leave unrelated modules usable. Trace context SHALL stay inside B.U.N.N.Y.; vendor diagnostics SHALL stay private.

#### Scenario: Restart after possible transmission
- **WHEN** durable unfinished responsibility records a possible write
- **THEN** restart reports uncertainty without reconstructing or resending the program

#### Scenario: Commit or publication failure
- **WHEN** responsibility cannot commit or an outcome cannot publish
- **THEN** the first refuses before effects and the second remains committed for outcomes-only publication

### Requirement: Operator UI and cached MCP status

The dashboard SHALL expose tracked takeover, finite gestures, independent Stop, automatic preference/Resume and exact held-neutral recovery with simulation, freshness, connection, input/target/joint and uncertain evidence. It SHALL preserve companions' ownership and use the existing frontend connection. MCP SHALL expose cached status only and refuse controls, motion, internal dispatch and saved-command resend. Keyboard, narrow layout, reduced motion and accessibility checks SHALL exercise these controls.

#### Scenario: Status inspection
- **WHEN** a page opens or MCP reads cached status
- **THEN** no actuator command is sent and synthetic evidence is not presented as physical observation

#### Scenario: Uncertain gesture in the UI
- **WHEN** a gesture is pending or uncertain
- **THEN** Stop remains reachable independently and neutral recovery requires acknowledgment of the current hold and guards
