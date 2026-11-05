## Purpose

Prepare bounded semantic Nanoleaf cue timelines and evaluate their current position deterministically without granting device authority or sending commands.

## ADDED Requirements

### Requirement: Immutable bounded timeline recipes

Timeline preparation SHALL validate version-one ordered, non-overlapping cues, duration, density, unique IDs and supported recipes before returning a plan. It SHALL freeze explicit recipe defaults and palettes so caller mutation and later favorite changes cannot alter a prepared plan.

#### Scenario: Valid plan survives a value round trip
- **WHEN** a valid plan using a supported preset is prepared and then serialized and prepared again
- **THEN** both plans contain the same explicit immutable recipe values

#### Scenario: Invalid or unbounded plan
- **WHEN** a plan has invalid values, an unsupported version, overlapping cues, excess size or density, or an unresolved favorite
- **THEN** preparation refuses it without scheduling or dispatching work

### Requirement: Current semantic cue selection

The timeline SHALL select a cue on its half-open interval, return gaps without a presentation instruction, and report end-of-show at the declared duration. Late samples SHALL select only the current cue and separately identify wholly missed cues. Intentional seeks SHALL select directly without replaying earlier cues.

#### Scenario: Late start and boundary
- **WHEN** a cursor starts after earlier cues ended, or advances exactly to a cue boundary
- **THEN** it returns only the cue active at that position and identifies completed cues missed by elapsed execution

#### Scenario: Gap and end
- **WHEN** the current position is in a gap or at the show duration
- **THEN** the result says gap or ended and supplies no blackout or restoration instruction

### Requirement: Explicit clock and generation fencing

The cursor SHALL use only caller-supplied local monotonic time. Pause SHALL freeze the position, resume SHALL anchor it anew, and seek SHALL preserve playing or paused state. Transport changes SHALL invalidate earlier generations. Stop and backward clock movement SHALL permanently retire that cursor.

#### Scenario: Seek invalidates queued callbacks
- **WHEN** a cursor seeks backward or forward and a callback from the prior generation arrives
- **THEN** the old callback returns no result, while the current generation selects the requested position without catch-up work

#### Scenario: Pause, stop and reconstruction
- **WHEN** time advances while paused, or a stopped cursor receives a later resume/sample, or a new cursor is constructed
- **THEN** pause retains its position, stopped work cannot resume, and a new cursor requires explicit start

### Requirement: Existing renderer and evidence boundaries

Selected recipes SHALL use the existing Nanoleaf encoder and layout validation for Lines and NL22. Evaluation and rendering SHALL perform no capture, device, SDK, persistence or timer operation. Results SHALL describe semantic selections and generated payloads without claiming transmission, physical success, atomic target writes or phase-accurate playback.

#### Scenario: Independent synthetic targets
- **WHEN** selected recipes are rendered against synthetic Lines and NL22 layouts
- **THEN** their values obey the canonical encoder bounds and target addressing, and incompatible changed layouts are refused without affecting another target
