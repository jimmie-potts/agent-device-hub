## ADDED Requirements

### Requirement: Read-only Nanoleaf configuration
The dashboard SHALL show the Nanoleaf integration settings, element mapping, task mapping and project color forms only for the operations the `nanoleaf.integration/1.0` snapshot marks supported. One line SHALL name the unsupported ones. A read-only device, such as the NL22 Light Panels, SHALL still show its mode, power, brightness and scene controls from its controller v1 snapshot, with scenes labelled by that device's user-chosen names. The dashboard SHALL NOT send an extension command for an unsupported operation. Maps to [Hub #323](https://github.com/jimmie-potts/agent-device-hub/issues/323).

#### Scenario: Panels next to the Lines
- **WHEN** the Panels' integration snapshot marks all four configuration operations unsupported and the Lines' marks them supported
- **THEN** the Panels view shows Mode, Power, Brightness and Scenes, no configuration form and one line naming the four, while the Lines view keeps every configuration form and no such line

#### Scenario: Commands on a read-only device
- **WHEN** the user activates a scene and applies brightness on the Panels
- **THEN** each sends exactly one guarded controller v1 command for the Panels, and no extension command reaches either device

#### Scenario: Operation withdrawn after render
- **WHEN** a configuration draft is ready and the snapshot read just before sending marks its operation unsupported
- **THEN** nothing is sent, the form is removed and the line names that operation
