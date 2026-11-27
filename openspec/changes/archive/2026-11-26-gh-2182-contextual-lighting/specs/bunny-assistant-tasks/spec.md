## ADDED Requirements

### Requirement: Contextual lighting settings

Conversation SHALL use the selected supervisor's interpretation of the current authenticated owner request to resolve supported lighting power, brightness, color and temperature. The Hub SHALL validate the result against registered device identity, capability, settings, grants and current command guards. The current request supplies action authority. Authorized conversation context supplies references.

#### Scenario: Follow-up setting and read

- **WHEN** the owner sets a configured light's brightness, refers back to the light to change a supported setting, and asks how the light is set
- **THEN** each valid setting change reaches the exact light once through its registered writer
- **AND** the status question reads the known setting under the current grants and sends no write.

#### Scenario: Ineligible or ambiguous proposal

- **WHEN** the proposal has an ambiguous target or lacks a required setting
- **THEN** Conversation asks a focused question before dispatch.
- **WHEN** the settings are invalid or the permission, device binding, capability or controller guard refuses the request
- **THEN** the affected device receives no command.

#### Scenario: Receipt after interruption

- **WHEN** the action is interrupted or the same request is delivered again
- **THEN** the original receipt remains authoritative and a possibly sent effect is not sent again.

#### Scenario: Context preserves ambiguity and owner qualification

- **WHEN** an earlier owner message uses a name shared by one light's ID and another light's label
- **AND** the current owner request refers back without resolving that collision
- **THEN** Conversation asks for the exact device and sends no command even if the model supplies an ID.
- **WHEN** the owner qualifies a shared label by device owner
- **THEN** the requested route may resolve that owner's eligible device.

#### Scenario: A color proposal is missing saturation

- **WHEN** a valid color proposal specifies hue for a resolved light and lacks saturation
- **THEN** Conversation asks one focused saturation question and sends no command until the owner answers.
- **AND** the completed proposal preserves the resolved target and hue and passes the current permission, mode and device revision checks before dispatch.
- **AND** the owner answer supplies one whole saturation percentage that matches the proposed value. An answer with no usable percentage, conflicting values or incompatible units sends no command.

#### Scenario: Context remains available in a read-only configuration

- **WHEN** the owner asks a contextual LIFX status question with the LIFX read tool enabled
- **THEN** Conversation reads the eligible light under the current grants without requiring or adding a lighting write tool.


#### Scenario: Explicit quantities keep their meaning

- **WHEN** the owner names a starting value and a desired value
- **THEN** the selected supervisor distinguishes them and the Hub validates the whole desired quantity in the registered unit, including signed digits and whole numbers written in words.
- **WHEN** a proposed absolute setting drops a sign, uses a malformed quantity, conflicts with the cited owner value or exceeds the registered bounds
- **THEN** the Hub sends no command.
- **WHEN** the owner supplies a numeric lighting value with repeated or conflicting signs, or declares an unsupported unit beside the quantity or separately for that setting
- **THEN** Conversation asks for an unambiguous value in a supported unit and sends no command before the owner answers.
- **AND** a corrected numeric answer binds to the same selected device, operation and current guards. Clearly bare and natural-language settings remain supported.

#### Scenario: Relative and extreme settings use registered limits

- **WHEN** the owner asks for a supported relative brightness or temperature change
- **THEN** the Hub calculates the proposed setting in the selected unit from current observed state, rounds to the registered step and stays within the registered bounds.
- **AND** the Hub sends no command if the observation is stale or unknown, the observed base changes before dispatch, or the calculated setting is unchanged.
- **WHEN** the owner requests a supported extreme
- **THEN** the Hub uses the registered bound.
