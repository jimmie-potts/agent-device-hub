# nanoleaf-music-timeline Specification

## Purpose
Prepare bounded semantic Nanoleaf cue timelines and evaluate their current position deterministically without granting device authority or sending commands.

## Requirements

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

### Requirement: Immutable canonical cue frame preparation

Internal cue preparation SHALL produce immutable canonical zone keyframes against explicitly supplied validated Lines or NL22 layout values, with cue intensity, existing capability refusals and frame/payload bounds. The existing package effects namespace SHALL additively expose pure canonical frame preparation while preserving its existing exports. Existing ordinary animation payloads and version-one cue formats SHALL remain unchanged. Preparation SHALL perform no device, SDK, persistence, timer or saved-layout read operation and SHALL grant no playback authority.

#### Scenario: Canonical values and isolation
- **WHEN** a cue is prepared for synthetic Lines or NL22 values and the caller later changes its inputs
- **THEN** prepared values remain unchanged and their encoded animation matches the existing canonical renderer, with the same target addressing and bounds

#### Scenario: Incompatible layout
- **WHEN** supplied layout values cannot support the recipe or exceed existing renderer limits
- **THEN** preparation refuses with the existing typed reason and performs no operation

### Requirement: Honest cue transition location

Cue-relative elapsed time SHALL locate each zone's transition using its actual keyframe durations. Results SHALL distinguish an unknown initial transition origin, a known previous endpoint, completed one-shot playback and cue end. Exact boundaries SHALL begin the next transition; only looping recipes SHALL wrap, using the last endpoint as the later cycle's first origin. Invalid positions SHALL be refused. Results SHALL be immutable, deterministic and independent of sampling order, without fabricated RGB interpolation or physical timing claims.

#### Scenario: Unequal durations and loop boundary
- **WHEN** a position falls within or exactly between unequal transitions, or on a later loop cycle
- **THEN** the result identifies the canonical target, prior endpoint when known, cycle and elapsed/remaining transition time without assuming equal frame durations

#### Scenario: Initial uncertainty and one-shot completion
- **WHEN** a position lies in the initial first transition or after a non-looping recipe's full duration
- **THEN** the first origin remains unknown, or the one-shot result names its final endpoint without restarting

#### Scenario: Pause, seek and cue end
- **WHEN** a cursor pauses, resumes or seeks and the selected cue's current elapsed time is located, or the position reaches cue end
- **THEN** location uses that elapsed time without catch-up or prior sample state, and cue end supplies no presentation instruction
