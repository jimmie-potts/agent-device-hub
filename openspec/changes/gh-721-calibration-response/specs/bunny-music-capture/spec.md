## ADDED Requirements

### Requirement: Explicit bounded quiet calibration

The core SHALL measure a quiet baseline only after an operator explicitly requests it for an active fresh selected microphone. It SHALL collect 50 uninterrupted 100 ms derived windows wholly after admission within a ten-second monotonic deadline. It SHALL report bounded percentile/maximum evidence and a heuristic editable gate candidate without altering raw measurements, capture authority or settings automatically. This contributes #721 AC1, AC2 and AC4.

#### Scenario: Quiet interval and explicit Apply
- **WHEN** 50 valid consecutive unclipped post-admission windows complete
- **THEN** the core records their numeric baseline and completes the calibration outcome; the gate changes only after a separate explicit Apply

#### Scenario: Queued windows and interrupted coverage
- **WHEN** pre-admission windows arrive, or collected coverage becomes stale, discontinuous, clipped or changes format
- **THEN** pre-admission windows are not counted; interrupted measurement fails without combining intervals or applying a partial candidate

#### Scenario: Independent clock origins and delayed deadline
- **WHEN** the producer and core monotonic clocks have different origins or a deadline callback runs late
- **THEN** collection uses source differences and a local monotonic deadline, and no result can succeed at or beyond that deadline

### Requirement: Retained settings require current gate qualification

The core SHALL retain microphone response settings and calibration evidence privately, while binding an enabled gate's current application to endpoint, generation, alias and format. Retirement, loss, stale coverage, discontinuity, format change or restart SHALL invalidate the application and candidate eligibility. Prior settings and evidence SHALL remain visible; they SHALL NOT reactivate a threshold without a fresh calibration or explicit manual application.

#### Scenario: New generation reuses an alias
- **WHEN** a new capture generation has the same public alias, including after a private device UID change
- **THEN** retained gate settings remain inactive until explicit current qualification or manual application; gate-off defaults can show an uncalibrated response

#### Scenario: Quiet is a relative digital claim
- **WHEN** calibration reports its observed percentile and suggested threshold
- **THEN** it identifies the heuristic and observed interval without claiming acoustic quiet, sound pressure, frequency-response calibration or beat confidence
