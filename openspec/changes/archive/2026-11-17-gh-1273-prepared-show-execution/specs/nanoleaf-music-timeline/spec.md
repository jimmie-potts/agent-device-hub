## ADDED Requirements

### Requirement: Admit a saved show through its light's worker

The Nanoleaf module SHALL resolve an exact saved show revision and validate every cue against the current layout and stream capabilities before writing to the selected light. A show SHALL start only on explicit admission in Free, through that light's existing worker and journal. Each light SHALL admit and schedule its show independently.

#### Scenario: Invalid or changed layout

- **WHEN** a saved show is missing, malformed or incompatible with the current layout, including an NL22 panel ID outside its stream range
- **THEN** admission returns a typed refusal before writing to the light

#### Scenario: Independent playback

- **WHEN** the two lights admit the same revision and the owner subsequently saves another version
- **THEN** each worker runs the admitted revision and one worker's failure or ending leaves the other worker's schedule and device alone

### Requirement: Schedule only the current cue

A prepared session SHALL sample the existing timeline cursor on its local runtime clock, bound device sends by the existing maximum cadence, and fence obsolete work by generation. A Start SHALL derive its target from the accepted delay on the receiver's local clock. Entry SHALL wait for that target. A late entry SHALL advance the initial position by elapsed time. The worker SHALL report the cumulative number of distinct wholly missed cue IDs in bounded evidence that survives restart. It SHALL distinguish scheduling and transmission from observation of the physical display.

#### Scenario: Transport changes and a late worker

- **WHEN** time reaches a cue boundary, a worker wakes after a whole cue expired, or an operator seeks forward or backward
- **THEN** the next eligible frame uses only the current cue and phase, earlier work cannot send, and intentional seeks do not count skipped cues as missed

#### Scenario: Pause and resume

- **WHEN** a prepared show pauses, seeks while paused, then explicitly resumes
- **THEN** the pause holds the last frame, the worker keeps checking for interruption, and resume schedules only from the new position

### Requirement: End under the saved-show participation policy

The worker SHALL apply the existing guard for manual takeover and guarded base restoration. Stop, alert, source loss and natural completion SHALL end the session and attempt guarded restoration. A manual choice SHALL end it without a restoration write. A stopped or interrupted session SHALL never replay after restart. The NL22's existing observation limit remains in effect. If the light reports the same selection, power and brightness after an unsaved effect, the worker can still attempt base restoration on Stop.

#### Scenario: Interruption races a device read

- **WHEN** an alert, Stop, newer choice or clock discontinuity occurs while a status read is outstanding
- **THEN** no further frame sends after the worker sees the interruption, and restoration follows the ending and the existing ownership guards

#### Scenario: Unanswered device operation

- **WHEN** the worker loses the response to external-control entry or to a journaled Stop write
- **THEN** it keeps the existing uncertain outcome and hold, and does not resend the operation

#### Scenario: Indistinguishable NL22 effect

- **WHEN** an unsaved effect replaces the stream on the NL22 and its selection, power and brightness still match
- **THEN** Stop can restore the prior saved scene because the light reports no distinguishable takeover
