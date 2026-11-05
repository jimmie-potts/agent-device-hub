## ADDED Requirements

### Requirement: Explicit Music input measurement controls
The Audio page SHALL expose the current Music-only capture state and explicit measurement Start/Stop through the existing core owner and tracked command path. It SHALL bind commands to current authoritative revision and endpoint evidence, distinguish accepted from completed work, preserve failed and uncertain outcomes, and never resend automatically. Stop SHALL remain independently available during pending or uncertain Start when the core permits stopping. Existing playback controls SHALL retain their behavior.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or appears in another tab
- **THEN** it follows current capture state without starting, stopping or replaying capture

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts Music measurement and later stops it
- **THEN** each deliberate action sends one revision-guarded tracked command, and the page shows acceptance separately from current capture state and its final outcome

#### Scenario: Stop while start is unresolved
- **WHEN** Start remains pending or uncertain and the current core state permits Stop
- **THEN** the independent Stop action remains available and uses the latest core revision without resending Start

#### Scenario: Authority or source unavailable
- **WHEN** the browser is read-only, the core state is stale or the Music endpoint is unavailable
- **THEN** unavailable actions explain their reason and no capture command is sent

### Requirement: Qualified expiring Music measurements
The Audio input meter SHALL display only actual derived measurements from the selected producer endpoint and active generation. It SHALL distinguish measured zero from unavailable input, preserve declared numeric meaning, refuse malformed/reordered/expired evidence and clear values on source, generation, state or connection loss. Freshness SHALL use a qualified core-time interval bounded by the local request and receipt, never an unqualified browser wall clock or a newly assigned receipt timestamp.

#### Scenario: Fresh signal and silence
- **WHEN** valid current-generation features arrive while the core reports active capture
- **THEN** the meter displays their actual level, including zero for measured silence, with numeric peak and full-scale crossing evidence

#### Scenario: Expiry and discontinuity
- **WHEN** features expire, arrive for an old generation, or capture becomes stale or disconnected
- **THEN** the meter becomes unavailable without retaining a live-looking value or changing its original evidence time

#### Scenario: Clock qualification fails
- **WHEN** the sync request is too delayed or the browser clock moves backward or jumps relative to its monotonic clock
- **THEN** measurement display stays unavailable until a new bounded sync qualifies time, and no capture command is sent by that recovery

### Requirement: Measurement-only accessible presentation
The new Audio card SHALL identify Music.app and explain that it measures audio without controlling lights. It SHALL offer no unsupported microphone, lighting effect, target or calibration control. The card SHALL use the existing shell and accessible semantic controls, with visible keyboard focus and fitting content at desktop and 320/390px widths in light/dark appearance and reduced motion.

#### Scenario: Synthetic browser acceptance
- **WHEN** the card is exercised against a disposable runtime with synthetic producer features
- **THEN** keyboard, responsive layout and accessibility checks pass, with no real source, microphone, device or installed service involved
