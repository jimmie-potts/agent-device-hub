## MODIFIED Requirements

### Requirement: Tidbyt and LIFX component views

The dashboard SHALL show `tidbyt` and `lifx` components in the common navigation and component view with the generic controls their controller v1 snapshots declare, and SHALL explain each unavailable control. A Tidbyt view SHALL say that its status and now-playing tiles are published by the local host and that it has no supported controls. A LIFX view SHALL read the lighting snapshot and show the observed color with its age, or unknown. It SHALL offer a color control (hue and saturation) and a color-temperature control within the declared kelvin range when the lighting capabilities declare them and the credential has control scope. A LIFX view whose lighting capabilities declare neither SHALL show one line naming that instead of the two forms. Each lighting control MUST send exactly one `lifx-light` 1.0.0 request through the hub's lighting route. That request MUST carry the guards from a lighting read taken immediately before sending, and MUST NOT turn the bulb on or change power or brightness. Results use the same receipt wording, conflict, uncertainty and lock rules as the general controls. Neither view SHALL show an advanced-editor link.

#### Scenario: Available and unavailable controls
- **WHEN** a control credential opens a Tidbyt component whose snapshot declares no capability and a LIFX component whose snapshot declares power and brightness with color and temperature lighting
- **THEN** the Tidbyt view shows one line naming the missing general capabilities and no general-control forms, and the LIFX power, brightness, color and temperature controls are enabled

#### Scenario: LIFX color change
- **WHEN** the user submits a new hue and saturation
- **THEN** the dashboard reads the lighting snapshot again, sends one `lifx.color.set` with that read's guards, and shows the receipt without claiming the bulb's visible color

#### Scenario: Unqualified bulb or read-only credential
- **WHEN** the lighting snapshot declares no color or temperature, or the credential is read-only
- **THEN** an unqualified bulb shows one line for its general controls and one for Lighting, a read-only credential sees the lighting controls disabled with the reason named, and no lighting request is sent

## ADDED Requirements

### Requirement: Power control starting value

The Power control SHALL start from the controller's desired power when it is known. Otherwise it SHALL start from the observed power when the snapshot has one, and its hint SHALL show that reading and its age. Otherwise it SHALL start with no selection and a hint that the current power is unknown, so that either On or Off can be sent as one explicit command. The no-selection state SHALL NOT be submittable.

#### Scenario: Unknown power
- **WHEN** a component's desired and observed power are both unknown
- **THEN** the Power control has no selection, says the current power is unknown, and choosing On sends one `power.set` with `on: true`

#### Scenario: Observed off
- **WHEN** desired power is unknown and the observation says the device is off
- **THEN** the Power control starts at Off with the reading's age, and choosing On sends one `power.set` with `on: true`

### Requirement: No dead controls and distinct disabled buttons

A component whose controller v1 snapshot declares none of power, brightness, media and scenes SHALL show one line naming those capabilities as not declared, instead of the four general-control forms. Every disabled button in the dashboard SHALL use a distinct disabled style from skin tokens, not transparency alone, and the view SHALL keep passing the automated accessibility scan.

#### Scenario: Status-only component
- **WHEN** the Tidbyt or another component declares no general capability
- **THEN** its view shows one line and no Power, Brightness, Media or Scenes form

#### Scenario: Disabled button
- **WHEN** a control is unavailable
- **THEN** its button's computed background and text colors differ from an enabled button's, and it is not clickable
