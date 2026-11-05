## ADDED Requirements

### Requirement: Private reactive preset library

For [#722 AC4](https://github.com/jimmie-potts/agent-device-hub/issues/722), Nanoleaf SHALL own up to 32 immutable named reactive presets in its existing private store. Each preset SHALL carry the versioned document `nanoleaf-reactive-preset/2.0`, a stable neutral identity, a name of 1–80 Unicode characters without controls, and one fully explicit frozen `MusicRecipeV1`. Saving SHALL accept only the supported closed V1 effect fields and bounds. Each stored document SHALL be at most 2 KiB, and the complete serialized catalog SHALL be at most 128 KiB. Catalog reads SHALL retain corrupt bytes and refuse invalid data rather than repair or hide them. Neither raw audio nor core capture/calibration settings SHALL enter the recipe.

#### Scenario: Explicit save and restart
- **WHEN** the operator explicitly saves a valid named recipe with the current catalog revision
- **THEN** Nanoleaf commits that immutable recipe, the new catalog and its observed metadata outcome atomically
- **AND** reload and restart preserve every earlier recipe without changing a device, journal, configuration revision, last device outcome or worker schedule

#### Scenario: Unsupported or stale save
- **WHEN** a request contains an unsupported version, effect, parameter or bound, a duplicate identity, an expired request or a stale catalog revision
- **THEN** the owner refuses before effects with the applicable registry code and preserves the library

#### Scenario: Capacity and store failure
- **WHEN** a save reaches the count, document, catalog or physical storage limit, or catalog/outcome insertion fails
- **THEN** it refuses without a partial save or loss of earlier presets
- **AND** publication failure after commit retains the original state and outcome for outbox publication without command replay

#### Scenario: Existing private database
- **WHEN** the new source opens a previous-schema database containing static favorites and decorative shows
- **THEN** initialization adds an empty reactive library without changing those existing rows and repeated initialization is harmless

### Requirement: Reactive preset drafts in the existing preview

The existing Wall Music effect preview SHALL show the owner-synced library through `nanoleaf-reactive-presets/2.0` at target `reactive-presets`. Read-only users SHALL be able to inspect and load a saved recipe into a local draft. Only an explicit control-authorized Save new preset SHALL send `nanoleaf-reactive-preset-save/2.0`, using a current catalog revision and the existing tracked command behavior. Failed or uncertain saves SHALL retain the draft; uncertain work SHALL keep the shared attempt locked. Reload, reconnection and catalog refresh SHALL never automatically save, resend or replace a local draft. Local load SHALL preserve all effect-local V1 parameters and show noneditable values truthfully.

#### Scenario: Save, load and preview
- **WHEN** an operator edits palette/intensity, saves a named preset, reloads and explicitly loads it
- **THEN** the exact frozen recipe becomes the local draft and an explicit Preview uses that complete recipe on fixed generated input and example geometry
- **AND** opening, loading and saving never starts capture, targets lights or applies a device effect

#### Scenario: Read-only or stale library
- **WHEN** the user has read-only access or the catalog, connection or operation copy is stale
- **THEN** save is disabled while saved data and the local draft remain distinguishable
- **AND** neither a delayed initial sync result nor a stale preview response makes the view current

#### Scenario: Full recipe request compatibility
- **WHEN** a caller supplies either the existing closed built-in preview request or the closed full-recipe request
- **THEN** the canonical renderer prepares only the bounded synthetic result, preserving existing built-in behavior
- **AND** every supported maximal full-recipe request fits the gateway's unchanged 512-character query value limit
