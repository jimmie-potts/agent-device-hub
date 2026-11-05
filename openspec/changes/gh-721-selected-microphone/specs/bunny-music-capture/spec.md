## MODIFIED Requirements

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
- **THEN** the producer reports unavailable or failure with a registered code, requests no new permission and starts no substitute input

## ADDED Requirements

### Requirement: Selected microphone and explicit permission setup

The producer SHALL resolve the explicitly selected microphone alias to its private configured device identity. Input discovery and permission requests SHALL require separate explicit local operations. Discovery SHALL perform no capture or permission request. Permission setup SHALL perform no capture, including after a grant. A normal capture start SHALL check existing authorization and SHALL NOT prompt for permission. A configured capability SHALL NOT claim observed device presence or authorization.

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
