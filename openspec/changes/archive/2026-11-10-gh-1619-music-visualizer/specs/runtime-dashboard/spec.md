## ADDED Requirements

### Requirement: Read-only music visualizer on Audio, its full view and Home
The dashboard SHALL offer a music visualizer on the Audio page, in a full view at `#/audio/visualizer` and as a Home card that is not placed by default. Each surface SHALL draw only the derived capture features the Audio page already projects, and only while they are qualified: synchronized with a qualified clock, fresh, and from the active capture source and generation. It SHALL use the applied response values when present and otherwise the measured level and bass, mid and treble bands. It SHALL ease toward the newest feature window and SHALL NOT replay skipped windows. When measurement is off, idle, starting, stale, stopping, uncertain or unavailable, when no fresh window is present, or when the generation changes, it SHALL show a still resting scene and state the reason instead of frozen or invented motion. The full view SHALL cover the page chrome, SHALL offer full screen through the browser's Fullscreen API, and Exit or Escape SHALL return to Audio; the Home card SHALL show the chosen effect, any resting reason and a link to the full view. The visualizer SHALL send no command, start no capture, control no lights and add no message format. Surfaces on one page SHALL share one read-only capture scope.

#### Scenario: Live measurements drive the effect
- **WHEN** a disposable runtime receives synthetic feature windows for an active capture
- **THEN** the chosen effect on Audio, the full view and the Home card follows the level and band changes from the newest window

#### Scenario: The stream stops, goes stale or changes generation
- **WHEN** feature windows stop, the capture becomes stale, or the active generation changes
- **THEN** each surface shows a still resting scene with its reason, and a new generation starts without carrying motion from the old one

#### Scenario: Resting while measurement is not running
- **WHEN** the Home card is placed while measurement is idle or the producer is off
- **THEN** it rests and states why, and it can still be added, moved and removed with the existing Home editor

#### Scenario: The visualizer sends nothing
- **WHEN** a viewer opens, switches and expands the visualizer
- **THEN** no command, capture start or lighting request is sent, and the page makes one capture sync for all its surfaces

### Requirement: Browser-only visualizer effect choice
The visualizer SHALL offer Spectrum bars and Bass pulse. The chosen effect SHALL be a per-viewer preference kept in the browser's local storage, followed by the browser's other tabs, and SHALL NOT be a shared saved setting or a message. When storage is unavailable or refuses access, the choice SHALL still apply for the page.

#### Scenario: The choice survives a reload
- **WHEN** a viewer chooses Bass pulse and reloads the page
- **THEN** every visualizer surface in that browser shows Bass pulse, and no other browser's choice changes

#### Scenario: Storage is unavailable
- **WHEN** reading or writing the stored choice fails
- **THEN** the visualizer uses the default effect and still switches effects for the page
