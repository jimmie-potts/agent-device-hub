## MODIFIED Requirements

### Requirement: Explicit Music lighting controls on Audio

The Audio page SHALL show a Music lighting card with one section per light in the core's synced `music-lighting-state` records. Each section SHALL show the session status, the saved preset in use and the last recorded ending, including its reason, restoration (with `uncertain`) and code when present. Each section SHALL explain what an ending will and won't put back: before Start from the light module's last read selection, unless the base was put back after that read, and otherwise by the general rule; during a session and after its ending from what the light module says that session's base was. The card SHALL name no scene. It SHALL offer a saved reactive preset from the private Nanoleaf library and explicit Start and Stop through the shared tracked command path. Start SHALL carry the record's revision, the chosen preset and the current active Music.app capture endpoint and generation. Start SHALL be enabled only for an idle light, from fresh records, with an active Music.app capture, a fresh library holding the preset and control authority. Stop SHALL be available for starting, active, stopping and uncertain sessions, independent of an unresolved Start. The page SHALL never offer the microphone, switch a light's mode, send a command on load, reload, reconnect or record change, or restart a session after any ending. This contributes #722 AC2, AC3 and AC5, and #1614 AC3.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or the lighting, capture or library records change
- **THEN** the card follows the current records and sends no lighting command

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts a light with a saved preset during active Music.app measurement and later stops it
- **THEN** each action sends one revision-guarded tracked command, and the card shows the core's saved request, the light module's work outcome and the light's reported session state separately, followed by the recorded ending and restoration

#### Scenario: Endings never restart
- **WHEN** a session ends through Stop, an alert, a manual change, source loss, a device failure, a restart or a refusal, and Music capture later becomes active again
- **THEN** the card shows the ending in plain words with its restoration and code, and no Start is sent until the operator chooses Start again

#### Scenario: What an ending puts back
- **WHEN** the light's last read selection is a saved scene, a plain colour or a selection that cannot be selected again, a session plays over one of them, or it ends
- **THEN** the card says before Start, during the session and after the ending whether Stop, an alert or lost Music input puts the scene or colour back or leaves the last Music frame, that a scene or colour picked on the light wins except in the instant the session takes the light, that a brightness or power change there ends the session within about a second, after a Music frame may already have replaced the base, and, for an ending with restoration `none` over an unnamed base, that nothing was put back and why

#### Scenario: Light outside Free
- **WHEN** the light's saved mode is not Free and the operator starts it
- **THEN** the card has already explained that Start would be refused and the mode is never switched, and it shows the light's refusal as the recorded ending

#### Scenario: Unavailable inputs explain disabled controls
- **WHEN** the browser is read-only, command records are stale, the capture is inactive or a microphone, no preset is saved, or a Start or Stop is still unresolved
- **THEN** the affected control is disabled with its reason, a missing library links to the Music effect preview, and nothing is sent

#### Scenario: Stale reads and lost replies
- **WHEN** a lighting read fails or the connection drops, or a Start reply is lost
- **THEN** the card shows the last known state with controls disabled until a fresh read succeeds: a reconnect reads again on its own without sending anything, a restarted copy re-syncs on its own, a failed read waits for an explicit refresh, the lost Start stays locked and is not resent across reload, and Stop remains available once the record shows the session

#### Scenario: Accessible presentation
- **WHEN** the card is exercised with the keyboard against a disposable runtime at desktop, 390px and 320px widths in light and dark appearance
- **THEN** controls are labelled, status changes use live regions, content fits without horizontal overflow and automated accessibility checks pass
