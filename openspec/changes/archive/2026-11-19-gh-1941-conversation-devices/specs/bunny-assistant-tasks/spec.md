## ADDED Requirements

### Requirement: Device reads and capability discovery in Conversation

Conversation SHALL identify configured devices by name and owner-qualified identity and report the supported, owner-enabled actions. It SHALL use admitted owners' SDK records, preserve observation time, and distinguish stale, unavailable, and unsupported information. On explicit LIFX reads it SHALL request the existing owner sync when a record is due for refresh, within the tool deadline. It SHALL identify the result as stale if the owner has not published a new observation.

#### Scenario: Several devices have the same label

- **WHEN** a device request matches several devices
- **THEN** Conversation asks which owner-qualified device is meant and offers no write until that answer identifies a single device

#### Scenario: An integration has no control contract

- **WHEN** the owner requests an unsupported or disabled action on an installed integration
- **THEN** Conversation describes the limitation without a device command and still offers any permitted status read

### Requirement: Tracked owner approval across device integrations

Conversation SHALL propose one exact action on a selected device or explicit set of recipients. Approval SHALL bind the owner, target, effect, and the domain revision, generation or exact immutable library version required at admission. The SDK and core dispatcher SHALL carry the existing typed commands to their respective owners. The original approval and request identity SHALL persist across failures. A lost reply SHALL remain uncertain without an automatic resend. Multi-target actions SHALL present each target's effect evidence independently.

#### Scenario: Wemo respects its device policy

- **WHEN** the owner approves power on or off for an eligible Wemo plug identified by name
- **THEN** the existing Wemo command runs through that plug's queue with its hold and revision checks
- **AND** the original continuous run and maximum-on policy remain effective

#### Scenario: A saved artwork is presented

- **WHEN** the owner approves the saved artwork and exact display recipients
- **THEN** the existing art-show path prepares and presents it and Conversation exposes each display's tracked result, including skipped or uncertain effects

#### Scenario: Availability or approval changes

- **WHEN** a held target, revoked permission, stale revision, or changed generation invalidates a proposed write
- **THEN** the refusal is visible without starting a device effect

### Requirement: Light-show authoring and playback in Conversation

Conversation SHALL let the owner create a deterministic draft, edit its cues, and preview a storyboard through the existing authoring rules. Draft and preview operations SHALL send no lighting command. Saving SHALL use the existing guarded catalog operation and retain prior versions. Playing SHALL require approval for the exact saved version and eligible light. Stopping SHALL require approval for the active generation and preserve the owner's restoration behavior. [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) owns AI-generated drafts.

#### Scenario: Create, edit, preview and save

- **WHEN** the owner creates a draft, specifies a cue edit, previews it and explicitly saves
- **THEN** the storyboard shows the edited cue and the approved save creates one independently selectable version
- **AND** no lighting command was sent

#### Scenario: Play a saved version and stop it

- **WHEN** the owner selects a saved show version and eligible light, approves playback and later approves Stop
- **THEN** the existing playback owner runs that immutable version on the selected light and stops the selected generation

#### Scenario: Unsaved or stale selection

- **WHEN** the owner requests playback of an unsaved draft or an approval no longer matches the selected light, saved version or generation
- **THEN** Conversation reports the refusal and no playback starts from that approval
