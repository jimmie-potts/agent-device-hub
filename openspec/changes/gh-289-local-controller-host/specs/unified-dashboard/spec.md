## ADDED Requirements

### Requirement: Tidbyt and LIFX component views

The dashboard SHALL show `tidbyt` and `lifx` components in the common navigation and component view with the generic controls their controller v1 snapshots declare, and SHALL explain each unavailable control. A Tidbyt view SHALL say that its status and now-playing tiles are published by the local host and that it has no supported controls. A LIFX view SHALL read the lighting snapshot and show the observed color with its age, or unknown. It SHALL offer a color control (hue and saturation) and a color-temperature control within the declared kelvin range when the lighting capabilities declare them and the credential has control scope. Each lighting control MUST send exactly one `lifx-light` 1.0.0 request through the hub's lighting route. That request MUST carry the guards from a lighting read taken immediately before sending, and MUST NOT turn the bulb on or change power or brightness. Results use the same receipt wording, conflict, uncertainty and lock rules as the general controls. Neither view SHALL show an advanced-editor link.

#### Scenario: Available and unavailable controls
- **WHEN** a control credential opens a Tidbyt component whose snapshot declares no capability and a LIFX component whose snapshot declares power and brightness with color and temperature lighting
- **THEN** every Tidbyt control is disabled with the missing capability named, and the LIFX power, brightness, color and temperature controls are enabled

#### Scenario: LIFX color change
- **WHEN** the user submits a new hue and saturation
- **THEN** the dashboard reads the lighting snapshot again, sends one `lifx.color.set` with that read's guards, and shows the receipt without claiming the bulb's visible color

#### Scenario: Unqualified bulb or read-only credential
- **WHEN** the lighting snapshot declares no color or temperature, or the credential is read-only
- **THEN** the lighting controls are disabled with the reason named and no lighting request is sent
