## ADDED Requirements

### Requirement: Measured cue position

For a measured show, the worker SHALL evaluate the pinned timeline against qualified playback position using bounded, fresh playback evidence. A pause SHALL freeze cue advancement. A seek SHALL invalidate the earlier cursor generation before evaluating the cue at the new position. The worker SHALL discard elapsed cues and work from obsolete generations. A source, process, item, or output change that breaks alignment SHALL end the show through the existing restoration policy.

#### Scenario: Start in a cue

- **WHEN** a measured show starts while its scoped Music item is partway through a cue
- **THEN** the worker evaluates the cue at the aligned position and sends no earlier cues

#### Scenario: Seek across several cues

- **WHEN** a fresh seek moves within the same scoped Music item and playback context
- **THEN** the worker discards obsolete scheduled work and evaluates the timeline at the new position

#### Scenario: Playback evidence expires

- **WHEN** the worker can no longer bound the position of the scoped Music item
- **THEN** the worker stops advancing cues and applies the existing source-loss restoration policy

#### Scenario: Seek near the projected end

- **WHEN** a fresh seek lands within the cue timeline at the same worker turn as the previous projection would reach its end
- **THEN** the worker evaluates the new position without completing the show at the old position

#### Scenario: A later observation follows a seek before the worker runs

- **WHEN** the worker receives a seek and a normal observation between two worker turns
- **THEN** the normal observation retains the seek boundary and the worker discards work from the old position
