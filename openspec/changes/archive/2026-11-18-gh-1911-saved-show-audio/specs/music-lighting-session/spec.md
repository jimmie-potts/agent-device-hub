## ADDED Requirements

### Requirement: Explicit saved show start in Audio

Audio SHALL let a control user explicitly start an exact immutable saved decorative show version on one qualified Nanoleaf light from position zero with no requested delay. It SHALL identify the selected saved version and target separately from live Music.app lighting. Unsaved drafts and the storyboard SHALL remain outside playback. Existing tracked outcomes SHALL distinguish the core request from the module's result, and Stop SHALL use the active generation.

#### Scenario: Play an earlier saved version

- **WHEN** the operator chooses an exact saved version for one idle light and selects Start saved show
- **THEN** one tracked request carries the selected version and light's current revision, and a newer saved version does not replace the selection

#### Scenario: Unavailable evidence and passive page activity

- **WHEN** status or the show catalog is stale, control is unavailable, or a request is pending
- **THEN** Audio disables Start saved show
- **AND** navigation, edit, save, refresh and reconnect issue no playback command or retry

#### Scenario: Admission refusal and Stop

- **WHEN** the worker refuses admission or the operator stops an admitted show
- **THEN** Audio presents the tracked result and only explicitly requested Stop can send a generation-bound Stop
