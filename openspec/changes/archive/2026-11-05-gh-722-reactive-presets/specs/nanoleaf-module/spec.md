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

The existing Wall Music effect preview SHALL show the owner-synced library through `nanoleaf-reactive-presets/2.0` at target `reactive-presets`. Read-only users SHALL be able to inspect and load a saved recipe into a local draft. Only an explicit control-authorized Save new preset SHALL send `nanoleaf-reactive-preset-save/2.0`, using a current catalog revision and the existing tracked command behavior. Failed or uncertain saves SHALL retain the draft; uncertain work SHALL keep the shared attempt locked. Reload, reconnection and catalog refresh SHALL never automatically save, resend or replace a local draft. The view SHALL retain its draft and any stale catalog while disconnected, then acquire a fresh owner snapshot after reconnect. Save SHALL remain disabled until that snapshot and the operation copy are current. Local load SHALL preserve all effect-local V1 parameters and show noneditable values truthfully.

#### Scenario: Save, load and preview
- **WHEN** an operator edits palette/intensity, saves a named preset, reloads and explicitly loads it
- **THEN** the exact frozen recipe becomes the local draft and an explicit Preview uses that complete recipe on fixed generated input and example geometry
- **AND** opening, loading and saving never starts capture, targets lights or applies a device effect

#### Scenario: Read-only or stale library
- **WHEN** the user has read-only access or the catalog, connection or operation copy is stale
- **THEN** save is disabled while saved data and the local draft remain distinguishable
- **AND** neither a delayed initial sync result nor a stale preview response makes the view current

#### Scenario: Disconnect during catalog refresh
- **WHEN** a library refresh completes during disconnection and the connection returns
- **THEN** the view retains its draft and acquires a fresh owner snapshot without resending a save
- **AND** Save remains disabled until the replacement snapshot completes

#### Scenario: Full recipe request compatibility
- **WHEN** a caller supplies either the existing closed built-in preview request or the closed full-recipe request
- **THEN** the canonical renderer prepares only the bounded synthetic result, preserving existing built-in behavior
- **AND** every supported maximal full-recipe request fits the gateway's unchanged 512-character query value limit

## MODIFIED Requirements

### Requirement: Bounded synthetic Music preparation
An explicit authenticated content read SHALL prepare twenty finite RGB samples for fixed example geometry with at most twelve zones, using the existing canonical Music renderer. It SHALL accept either the closed version-one built-in/palette/intensity/example-model request or the separate closed version-one recipe/example-model request. Recipe preparation SHALL resolve supported V1 defaults and retain supplied effect-local values in its complete frozen recipe. The request branches SHALL remain mutually exclusive and reject undeclared fields. Decoded request bytes SHALL be bounded to 2 KiB and encoded response bytes to 16 KiB. The result SHALL identify the frozen recipe, synthetic stimulus, model, offsets and RGB values. Preparation SHALL read no configured layout, device, database, file, capture stream or clock and SHALL create no device work, state update, outbox message or ticket. Errors SHALL use registered meanings and fixed safe text.

#### Scenario: Canonical RGB for every effect and model
- **WHEN** each built-in is explicitly previewed on both supported example models
- **THEN** each sample agrees with the canonical renderer's static RGB output and the response remains within its declared limits

#### Scenario: Unsupported or oversized request
- **WHEN** a request contains an unsupported version, effect, model, field or parameter, or exceeds the request bound
- **THEN** preparation refuses it as invalid-request without external reads or changes

#### Scenario: Cancelled read
- **WHEN** the content request is cancelled before preparation completes
- **THEN** no preview is returned as success and no device or stored state is changed

#### Scenario: Full frozen recipe values
- **WHEN** a saved recipe with supported nondefault effect-local values is explicitly prepared
- **THEN** its complete frozen values and canonical RGB output are preserved without admitting device work or selecting an input
