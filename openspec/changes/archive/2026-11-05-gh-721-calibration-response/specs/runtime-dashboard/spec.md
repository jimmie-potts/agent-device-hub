## MODIFIED Requirements

### Requirement: Explicit Music input measurement controls
The Audio page SHALL accept registered capture state versions 2.0, 2.1 and 2.2 and expose the current Music or configured microphone state and explicit measurement Start/Stop through the existing core owner and tracked command path. It SHALL bind commands to current authoritative revision and endpoint evidence, distinguish accepted from completed work, preserve failed and uncertain outcomes, and never resend automatically. Stop SHALL remain independently available during pending or uncertain Start when the core permits stopping. Existing playback controls SHALL retain their behavior.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or appears in another tab
- **THEN** it follows current capture state without starting, stopping or replaying capture

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts the explicitly selected Music or configured microphone measurement and later stops it
- **THEN** each deliberate action sends one revision-guarded tracked command, and the page shows acceptance separately from current capture state and its final outcome

#### Scenario: Stop while start is unresolved
- **WHEN** Start remains pending or uncertain and the current core state permits Stop
- **THEN** the independent Stop action remains available and uses the latest core revision without resending Start

#### Scenario: Authority or source unavailable
- **WHEN** the browser is read-only, the core state is stale or the capture endpoint is unavailable
- **THEN** unavailable actions explain their reason and no capture command is sent

### Requirement: Measurement-only accessible presentation
The Audio card SHALL identify Music.app and any configured microphone by its public alias, and explain that it measures audio without controlling lights. A configured alias SHALL NOT imply device presence or permission. Selection alone SHALL start no capture. The card SHALL explain that microphone capture checks existing authorization and does not request permission. It SHALL offer no unsupported lighting effect or target control. The card SHALL use the existing shell and accessible semantic controls, with visible keyboard focus and fitting content at desktop and 320/390px widths in light/dark appearance and reduced motion.

#### Scenario: Synthetic browser acceptance
- **WHEN** the card is exercised against a disposable runtime with synthetic producer features
- **THEN** keyboard, responsive layout and accessibility checks pass, with no real source, microphone, device or installed service involved

#### Scenario: Bounded alias presentation
- **WHEN** the configured microphone alias has the maximum accepted length
- **THEN** selection, status and Start remain readable without page overflow at 320px before and during capture

#### Scenario: Explicit selection and refused microphone
- **WHEN** the operator selects a configured microphone, then explicitly starts it and the producer refuses the input
- **THEN** selection alone sends no capture command, the refusal leaves the meter unavailable, and the card directs the operator to check the device connection and existing Mac microphone permission without claiming a prompt was shown

## ADDED Requirements

### Requirement: Calibration and response preview controls

The Audio page SHALL provide explicit quiet measurement, Cancel and Apply controls for the active microphone, with saved sensitivity, gate, band emphasis and smoothing settings plus editable drafts. It SHALL distinguish raw input from a numerical response preview and retained settings from current gate qualification. Uncertain commands SHALL not replay or disable otherwise permitted Stop. This contributes #722 AC1 through AC5 without device dispatch.

#### Scenario: Complete synthetic calibration journey
- **WHEN** the operator measures synthetic quiet input, reviews its candidate and explicitly applies response settings
- **THEN** the raw meter remains unchanged while the separately labelled preview uses the committed settings and shows the gate's status

#### Scenario: Retired qualification and passive reload
- **WHEN** capture retires or the page reloads with retained settings
- **THEN** an enabled unqualified gate is visibly inactive, no measurement/application runs automatically and explicit manual reapplication or a new calibration is available when current input permits it

#### Scenario: Conflict, uncertainty and Stop
- **WHEN** Apply conflicts or its result is uncertain
- **THEN** the draft remains reviewable, no automatic retry occurs and the independent Stop control remains usable when core state permits it

#### Scenario: Local interruption precedes the core update
- **WHEN** the browser observes source discontinuity, a gap, format change or expiry before the core retires the current application
- **THEN** an enabled response preview stays inactive for that application revision until a new Apply qualifies it, while valid raw input can resume independently

#### Scenario: A candidate does not erase a conflicting draft revision
- **WHEN** another editor saves settings before the operator chooses a measured candidate for the retained draft
- **THEN** the saved-settings conflict remains visible and Apply stays disabled until the operator reviews the conflict explicitly
