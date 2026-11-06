## ADDED Requirements

### Requirement: Explicit Music lighting controls on Audio

The Audio page SHALL show a Music lighting card with one section per light in the core's synced `music-lighting-state` records. Each section SHALL show the session status, the saved preset in use and the last recorded ending, including its reason, restoration (with `uncertain`) and code when present. It SHALL offer a saved reactive preset from the private Nanoleaf library and explicit Start and Stop through the shared tracked command path. Start SHALL carry the record's revision, the chosen preset and the current active Music.app capture endpoint and generation. Start SHALL be enabled only for an idle light, from fresh records, with an active Music.app capture, a fresh library holding the preset and control authority. Stop SHALL be available for starting, active, stopping and uncertain sessions, independent of an unresolved Start. The page SHALL never offer the microphone, switch a light's mode, send a command on load, reload, reconnect or record change, or restart a session after any ending. This contributes #722 AC2, AC3 and AC5.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or the lighting, capture or library records change
- **THEN** the card follows the current records and sends no lighting command

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts a light with a saved preset during active Music.app measurement and later stops it
- **THEN** each action sends one revision-guarded tracked command, and the card shows the core's saved request, the light module's work outcome and the light's reported session state separately, followed by the recorded ending and restoration

#### Scenario: Endings never restart
- **WHEN** a session ends through Stop, an alert, a manual change, source loss, a device failure, a restart or a refusal, and Music capture later becomes active again
- **THEN** the card shows the ending in plain words with its restoration and code, and no Start is sent until the operator chooses Start again

#### Scenario: Light outside Free
- **WHEN** the light's saved mode is not Free and the operator starts it
- **THEN** the card has already explained that Start would be refused and the mode is never switched, and it shows the light's refusal as the recorded ending

#### Scenario: Unavailable inputs explain disabled controls
- **WHEN** the browser is read-only, command records are stale, the capture is inactive or a microphone, no preset is saved, or a Start or Stop is still unresolved
- **THEN** the affected control is disabled with its reason, a missing library links to the Music effect preview, and nothing is sent

#### Scenario: Stale reads and lost replies
- **WHEN** a lighting read fails or the connection drops, or a Start reply is lost
- **THEN** the card shows the last known state with controls disabled until an explicit refresh succeeds, the lost Start stays locked and is not resent across reload, and Stop remains available once the record shows the session

#### Scenario: Accessible presentation
- **WHEN** the card is exercised with the keyboard against a disposable runtime at desktop, 390px and 320px widths in light and dark appearance
- **THEN** controls are labelled, status changes use live regions, content fits without horizontal overflow and automated accessibility checks pass
