## MODIFIED Requirements

### Requirement: Content controls gated by status presentation

The dashboard SHALL disable Pixoo playlist selection and playback actions while Pixoo presents agent status in Monitor or a mode change is pending, SHALL disable Nanoleaf scene activation while the wall presents agent status in Work or Quiet, and SHALL disable LIFX color and color-temperature controls while a qualified bulb presents agent status in Work or Quiet; in each case while a mode change is pending or while the mode is unknown. In each case the view MUST show the reason and offer a one-click explicit switch to Media or Free through the existing mode control. Returning to Monitor, Work or Quiet MUST use the existing mode control. Because the Pixoo controller does not declare controller v1 modes, the Pixoo mode control and the explicit switch SHALL submit the device-owned Pixoo integration extension's mode operation through the hub's existing integration route with that extension's request ID, configuration revision and generation guards; controllers that declare controller v1 modes, including Nanoleaf and LIFX, keep the controller v1 mode command for both the mode control and the explicit switch. Playlists SHALL be listed by controller-declared ID until the device-owned naming extension is consumed. Scenes SHALL be listed only from the controller v1 `scenes` capability, labelled by the user-chosen names the device-owned integration extension supplies and by ID otherwise; browser and hub configuration MUST contribute no scene identities or names. LIFX power and brightness SHALL remain available in every mode.

#### Scenario: Monitor gating with explicit switch
- **WHEN** Pixoo is in Monitor and the user activates the explicit switch
- **THEN** one mode command to Media is submitted, no playlist or playback command is sent, and the content controls become available only after the Media mode is observed

#### Scenario: Playback in Media
- **WHEN** Pixoo is in Media and the user selects a declared playlist ID or activates a declared playback action
- **THEN** exactly one media command for that ID or action is submitted and its receipt is shown without a mode change

#### Scenario: Work or Quiet gating with explicit Free switch
- **WHEN** the Nanoleaf wall is in Work or Quiet and the user activates the explicit switch
- **THEN** one controller v1 mode command to Free is submitted, no scene command is sent, and scene activation becomes available only after the Free mode is observed with no pending mode change

#### Scenario: Scene activation in Free
- **WHEN** the wall is in Free and the user activates a declared scene
- **THEN** exactly one scene command for that scene ID is submitted, its receipt is shown without a mode change, and the scene is labelled by its user-chosen name when the integration snapshot supplies one and by ID otherwise

#### Scenario: Scene rejected by the controller
- **WHEN** the controller rejects a scene command with a typed failure because its mode changed after the browser observed Free
- **THEN** the typed failure is shown, no command is repeated, and the control stays available for a fresh explicit action

#### Scenario: LIFX Work or Quiet gating with explicit Free switch
- **WHEN** a qualified LIFX bulb is in Work or Quiet and the user activates the explicit switch
- **THEN** one controller v1 mode command to Free is submitted, no color or temperature command is sent, and both controls become available only after the Free mode is observed with no pending mode change

#### Scenario: LIFX color and temperature in Free
- **WHEN** a qualified bulb is in Free and the user submits a color or temperature change
- **THEN** exactly one `lifx-light` request is submitted with a fresh read's guards, its receipt is shown without a mode change, and power and brightness remain independently available in every mode

### Requirement: Tidbyt and LIFX component views

The dashboard SHALL show `tidbyt` and `lifx` components in the common navigation and component view with the generic controls their controller v1 snapshots declare, and SHALL explain each unavailable control. A Tidbyt view SHALL say that its status and now-playing tiles are published by the local host and that it has no supported controls. A LIFX view SHALL read the lighting snapshot and show the observed color with its age, or unknown. It SHALL offer a color control (hue and saturation) and a color-temperature control within the declared kelvin range when the lighting capabilities declare them and the credential has control scope. A LIFX view whose lighting capabilities declare neither SHALL show one line naming that instead of the two forms. A qualified LIFX bulb SHALL show the same generic mode control other mode-declaring components use, offering Work, Quiet and Free. Each lighting control MUST send exactly one `lifx-light` 1.0.0 request through the hub's lighting route. That request MUST carry the guards from a lighting read taken immediately before sending, and MUST NOT turn the bulb on or change power or brightness. Results use the same receipt wording, conflict, uncertainty and lock rules as the general controls. Neither view SHALL show an advanced-editor link.

#### Scenario: Available and unavailable controls
- **WHEN** a control credential opens a Tidbyt component whose snapshot declares no capability and a LIFX component whose snapshot declares power and brightness with color and temperature lighting
- **THEN** the Tidbyt view shows one line naming the missing general capabilities and no general-control forms, and the LIFX power, brightness, color and temperature controls are enabled

#### Scenario: LIFX color change
- **WHEN** the user submits a new hue and saturation
- **THEN** the dashboard reads the lighting snapshot again, sends one `lifx.color.set` with that read's guards, and shows the receipt without claiming the bulb's visible color

#### Scenario: Unqualified bulb or read-only credential
- **WHEN** the lighting snapshot declares no color or temperature, or the credential is read-only
- **THEN** an unqualified bulb shows one line for its general controls and one for Lighting, a read-only credential sees the lighting controls disabled with the reason named, and no lighting request is sent

#### Scenario: LIFX mode control
- **WHEN** a qualified bulb's snapshot declares `modes`
- **THEN** the view shows the same Work/Quiet/Free mode control other mode-declaring components use, and selecting a mode submits one controller v1 `mode.set` with a fresh read's guards
