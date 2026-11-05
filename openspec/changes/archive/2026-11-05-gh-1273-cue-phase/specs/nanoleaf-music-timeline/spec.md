## ADDED Requirements

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
