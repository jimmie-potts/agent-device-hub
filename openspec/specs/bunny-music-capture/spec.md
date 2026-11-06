# Music capture Specification

## Purpose

Measure Music.app audio or one explicitly configured microphone locally for explicitly started music lighting sessions, while keeping capture authority, freshness and measurement limits visible to consumers.

## Requirements

### Requirement: Explicit capture lifecycle

The producer SHALL capture only after an explicit start for its selected input and current session generation. Startup, connection, permission grant and reconnection SHALL NOT start capture. It SHALL support Music.app and one owner-configured named microphone, refuse unsupported inputs and start no substitute automatically.

#### Scenario: Connection without a start
- **WHEN** the producer connects and announces its configured capture support
- **THEN** it enumerates no input hardware and opens no audio source until an explicit operation requires it

#### Scenario: Stop fences delayed work
- **WHEN** stop, producer disconnect or process shutdown occurs
- **THEN** capture authority is fenced immediately, bounded teardown is attempted, pending features are discarded and a late frame from that generation cannot make the session active again; stopped is reported only after observed clean teardown, otherwise the result remains unavailable or uncertain

#### Scenario: Permission or source unavailable
- **WHEN** the selected capture path cannot start or loses its source
- **THEN** the producer reports unavailable or failure with a registered code and starts no substitute input; microphone capture requests no new permission

### Requirement: Local bounded measurements

The producer SHALL derive RMS, peak, clipping fraction, low/mid/high band levels and a heuristic amplitude-onset measure from bounded PCM windows. It SHALL publish numeric derived measurements only, at no more than ten feature publications per second. It SHALL distinguish onset confidence from musical beat or tempo confidence. Raw PCM SHALL NOT enter files, logs, network payloads or model requests.

#### Scenario: Synthetic signal measurements
- **WHEN** deterministic silence, tones in each band, amplitude steps and clipped samples enter the analyzer
- **THEN** levels and bands match documented numeric tolerances, silence has no false beat claim and clipping is reported

#### Scenario: Invalid samples or timing
- **WHEN** a window contains nonfinite data, unsupported format or discontinuous source time
- **THEN** the producer refuses or marks the discontinuity explicitly and does not publish a plausible uninterrupted measurement

### Requirement: Bounded delivery and honest freshness

Feature delivery SHALL keep at most one publication in flight and one replaceable pending frame. Uncoalesced lifecycle observations SHALL remain separate from coalesced features. Each feature SHALL name its capture generation, sequence, source window and source buffering age. Consumers SHALL reject old generations, duplicate or reversed sequences, expired frames and invalid timing. Source monotonic time SHALL NOT be presented as audible speaker time or Music.app track position.

#### Scenario: Slow consumer
- **WHEN** transport acknowledgment is delayed while several analysis windows finish
- **THEN** memory stays bounded, the newest pending frame replaces earlier pending frames, skipped sequence numbers reveal the delivery gap and recovery does not burst past the publication rate

#### Scenario: Stale data
- **WHEN** the current session receives no valid frame within its declared freshness interval
- **THEN** current capture state becomes stale or unavailable and consumers cannot treat the last level as live audio

#### Scenario: Clock qualification lost while idle
- **WHEN** the core's wall clock changes relative to its monotonic clock beyond the permitted drift after endpoint registration
- **THEN** a subsequent operator start is refused before sending capture work, the core retires the endpoint qualification and no duplicate registration or completed stop silently renews that qualification

#### Scenario: Silence versus failure
- **WHEN** valid zero-valued windows continue to arrive
- **THEN** capture remains live with silent measurements; missing windows are reported separately

### Requirement: Core owns current capture state

The core SHALL own the selected input, session generation and current capture lifecycle. Start and stop SHALL use existing operator admission and tracked outcomes. Accepted work SHALL be recorded before capture is requested. A restart SHALL expose capture as stopped or unavailable and SHALL NOT resend the prior start. Sync SHALL return current capture state, never a backlog of audio features to replay.

#### Scenario: Restart after a start
- **WHEN** the runtime restarts with a previously active capture generation
- **THEN** the old generation is retired, unfinished command responsibility is reported truthfully and no capture starts until another explicit request

#### Scenario: Incomplete start
- **WHEN** a start was dispatched but its result is lost
- **THEN** the operation is uncertain, no automatic retry occurs and current state makes no claim that capture succeeded

### Requirement: Private evidence boundaries

Published derived observations SHALL follow existing private core history retention. Delivery coalescing SHALL be described as a resource bound, not as complete observation retention. Source tests SHALL NOT claim installed, DRM-wide, AirPlay, microphone or physical timing qualification.

#### Scenario: Qualification report
- **WHEN** synthetic and disposable tests pass
- **THEN** the report identifies those tested paths and keeps real-source and physical acceptance separate

### Requirement: Selected microphone and explicit permission setup

The producer SHALL resolve the explicitly selected microphone alias to its private configured device identity. Input discovery and permission requests SHALL require separate explicit local operations. Discovery SHALL perform no capture or permission request. Permission setup SHALL perform no capture, including after a grant. A microphone capture start SHALL check existing authorization and SHALL NOT prompt for permission. A configured capability SHALL NOT claim observed device presence or authorization.

#### Scenario: Permission granted without a start
- **WHEN** an explicit permission setup operation receives a grant
- **THEN** it reports the result and exits without recording, connecting a producer endpoint or creating capture work

#### Scenario: No automatic input choice
- **WHEN** the configured microphone is missing, has an unsupported format or has no current permission
- **THEN** start fails with a fixed registered error, no default device is selected and Music capture is not started instead

#### Scenario: Selected device disappears
- **WHEN** an active microphone is removed, changes format or loses permission
- **THEN** that generation retires, the producer reports the failure and cleanup outcome, and later input requires a new explicit start

#### Scenario: Output streams remain outside capture
- **WHEN** microphone input starts on a device that also offers output streams
- **THEN** the producer disables its owned output-stream usage before IO, changes no default device or hardware setting and leaves other clients' stream configuration untouched

### Requirement: Microphone measurement provenance

Microphone features SHALL carry the selected public alias and generation while preserving the existing raw measurement semantics, timing bounds and numeric-only publication. The native device identity SHALL remain private to the local producer. Silence SHALL remain valid input and SHALL NOT trigger fallback, recalibration or another capture source.

#### Scenario: Current microphone measurement
- **WHEN** the selected microphone produces a valid synthetic signal window
- **THEN** its published RMS, peak, clipping, bands and onset measurements retain the analyzer's documented meaning and name that microphone alias

#### Scenario: Public data excludes native identity
- **WHEN** capture setup, features, current state or failures cross the authenticated SDK boundary
- **THEN** none contains the native device UID, raw samples, private configuration paths or arbitrary OS error text

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

#### Scenario: Coherent source, observation and receipt elapsed time
- **WHEN** counted windows advance their source clock but repeat their observed timestamp, arrive in an implausibly compressed burst or reverse receiver receipt time
- **THEN** calibration fails, creates no candidate and retires current gate qualification while preserving preferences and prior evidence

#### Scenario: Bounded delayed delivery
- **WHEN** the first-window-relative observed and receipt elapsed differences stay within the documented 51 ms and 601 ms uncertainty bounds, including their exact boundaries
- **THEN** otherwise valid consecutive windows can complete with sourceDurationMs 5000; exceeding either bound refuses the interval, without comparing different monotonic origins

### Requirement: Retained settings require current gate qualification

The core SHALL retain microphone response settings and calibration evidence privately, while binding an enabled gate's current application to endpoint, generation, alias and format. Retirement, loss, stale coverage, discontinuity, format change or restart SHALL invalidate the application and candidate eligibility. Prior settings and evidence SHALL remain visible; they SHALL NOT reactivate a threshold without a fresh calibration or explicit manual application.

#### Scenario: New generation reuses an alias
- **WHEN** a new capture generation has the same public alias, including after a private device UID change
- **THEN** retained gate settings remain inactive until explicit current qualification or manual application; gate-off defaults can show an uncalibrated response

#### Scenario: Quiet is a relative digital claim
- **WHEN** calibration reports its observed percentile and suggested threshold
- **THEN** it identifies the heuristic and observed interval without claiming acoustic quiet, sound pressure, frequency-response calibration or beat confidence
