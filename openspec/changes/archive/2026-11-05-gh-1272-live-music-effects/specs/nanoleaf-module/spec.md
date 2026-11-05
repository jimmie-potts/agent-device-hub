## ADDED Requirements

### Requirement: Frozen music recipes produce bounded deterministic frames

The Nanoleaf module SHALL provide internal version-1 recipes for level glow, bass pulse, three-band spectrum, traveling waves and ambient colors from bounded capture features. Recipes SHALL resolve all defaults and palette values and reject unknown versions, fields and values before rendering. Rendering SHALL use saved geometry and the existing display representation without performing device requests, changing mode or persisting features. This source capability contributes deterministic evidence to #1272; it SHALL NOT expose live music admission without the separate participation policy and worker integration.

#### Scenario: Five effects on both layout kinds
- **WHEN** each effect receives the same valid synthetic measurements, explicit source times and saved Lines or NL22 layout
- **THEN** repeated runs produce identical bounded RGB bytes, paired Lines zones share colors, and only Lines carries the logical-panels flag

#### Scenario: Measurements and silence
- **WHEN** legal capture measurements exceed normalized intensity or contain valid silence with low onset confidence
- **THEN** output remains bounded, silence follows the effect's declared decay, and no beat or BPM is inferred

#### Scenario: Missing geometry and incompatible recipes
- **WHEN** spatial positions are incomplete, a recipe version or field is unsupported, or output exceeds the existing frame or byte bounds
- **THEN** rendering is refused before producing a payload

#### Scenario: Frozen replay
- **WHEN** a fully resolved recipe is serialized and loaded again, or the caller mutates its original recipe and layout after preparation
- **THEN** the supported recipe's interpretation and prepared output remain unchanged

### Requirement: Music input is fresh latest-value data within one binding

Music feature intake SHALL validate the existing profile-2 capture family, producer source, endpoint and generation, retain at most one immutable feature, and accept only increasing sequence and source time. It SHALL judge freshness from the payload's original validity and a receiver-local monotonic deadline, without comparing absolute remote and local monotonic clocks. Duplicate or invalid input SHALL NOT extend freshness. Expiry, discontinuity after the initial accepted window, clock invalidity or explicit retirement SHALL require a new input instance; no late frame SHALL reactivate the retired instance.

#### Scenario: Fresh envelope cannot refresh old observations
- **WHEN** a duplicate, reverse-sequence or already expired feature arrives in a new envelope
- **THEN** it cannot replace or refresh the latest feature, and the slot is unavailable at its original expiry boundary

#### Scenario: Independent clocks
- **WHEN** source monotonic timestamps have a different origin from receiver monotonic time
- **THEN** freshness still follows payload wall validity and the local receipt deadline, while effect timing follows source-time differences only

#### Scenario: Retirement and discontinuity
- **WHEN** a valid bound feature reports discontinuity after initialization, source time reverses, the receiver monotonic clock moves backward or drifts beyond the shared tolerance, freshness expires, or the caller retires the input
- **THEN** no subsequent frame from that instance is available, even if later messages appear fresh

#### Scenario: Input bursts
- **WHEN** multiple increasing valid features arrive before consumption, including sequence gaps
- **THEN** only the newest feature is available and missing windows produce no replay queue or synthesized beat

#### Scenario: Initial native window
- **WHEN** the first accepted window of a new binding has the native producer's initial discontinuity marker
- **THEN** it initializes fresh effect state without carrying earlier capture history
