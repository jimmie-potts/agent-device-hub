## MODIFIED Requirements

### Requirement: Explicit browser speech availability
Speech SHALL default to off. Enabling text companions SHALL NOT enable speech. An authorized operator SHALL explicitly select one qualified browser endpoint and declare availability for its current connection. The UI SHALL explain that calls and other applications are not detected and that the operator must mute before interruption-sensitive activity. Quiet, category mute, stale or cleared attention, missing live state and unavailable output SHALL prevent new unsolicited speech. Work and Free SHALL permit a fresh eligible coding question after explicit enablement.

#### Scenario: Independent enablement
- **WHEN** text companions are enabled but speech has not been enabled on the current connection
- **THEN** eligible coding attention remains visible and produces zero audio

#### Scenario: Current question with permission
- **WHEN** the selected endpoint receives a fresh coding question in Work or Free with live evidence, enabled text and speech, manual availability and an unmuted category
- **THEN** it can speak the existing fixed phrase once after a final policy check
- **AND** Quiet, mute or cleared attention before playback suppresses the output

#### Scenario: Availability ends with the endpoint
- **WHEN** the selected endpoint reloads, disconnects, is lost, unmounts or observes runtime restart
- **THEN** its availability is invalidated and any local speech is cancelled
- **AND** reconnect requires explicit enablement, admits only new opportunities and never selects another tab

#### Scenario: Presentation changes during browser speech
- **WHEN** the selected Conversation tab changes profile, resizes, or opens or closes Voice or Details
- **THEN** it keeps the same selected endpoint and any eligible playback continues
- **AND** the controls explain when Enable is unavailable, another tab remains excluded, and reload or reconnect requires a fresh Enable
