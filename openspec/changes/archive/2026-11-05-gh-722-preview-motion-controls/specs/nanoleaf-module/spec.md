## MODIFIED Requirements

### Requirement: Explicit reactive recipe drafts
The shared Nanoleaf Wall interface SHALL offer five immutable version-one built-in Music recipes, one per existing reactive effect, with an unsaved palette/intensity draft, editable existing V1 effect-specific motion values and a choice of example Lines or NL22 geometry. Draft edits SHALL remain local. Audio SHALL expose a contextual link to this existing interface. This increment SHALL preserve the separate requirement for custom reactive-preset persistence.

#### Scenario: Five effects are available without light admission
- **WHEN** an operator opens the preview within the Wall page
- **THEN** all five built-ins and their palette/intensity controls are available without starting capture, selecting devices or sending a command

#### Scenario: Draft edits remain unsaved
- **WHEN** the operator edits a draft and reloads the page
- **THEN** the page returns to its built-in default without writing a preset, configuration or operation

#### Scenario: Effect-specific motion edits
- **WHEN** the operator edits bass-pulse half-life from 100 to 2000 ms, chooses one of the eight supported spectrum/traveling-wave directions, or edits a traveling-wave cycle from 400 to 10000 ms
- **THEN** only the local complete V1 recipe changes, within the existing canonical bounds
- **AND** sensitivity and renderer smoothing remain read-only, effect changes use that effect's existing defaults without leaking variant fields, and invalid edits preserve the previous draft

#### Scenario: Explicit preview after a motion edit
- **WHEN** a motion value changes during an earlier preview request
- **THEN** that response cannot replace the newer draft and the operator must explicitly request a new preview
- **AND** the complete edited V1 recipe is used on fixed generated input and example geometry without a capture or device command


### Requirement: Reactive preset drafts in the existing preview

The existing Wall Music effect preview SHALL show the owner-synced library through `nanoleaf-reactive-presets/2.0` at target `reactive-presets`. Read-only users SHALL be able to inspect and load a saved recipe into a local draft. Only an explicit control-authorized Save new preset SHALL send `nanoleaf-reactive-preset-save/2.0`, using a current catalog revision and the existing tracked command behavior. Failed or uncertain saves SHALL retain the draft; uncertain work SHALL keep the shared attempt locked. Reload, reconnection and catalog refresh SHALL never automatically save, resend or replace a local draft. The view SHALL retain its draft and any stale catalog while disconnected, then acquire a fresh owner snapshot after reconnect. Save SHALL remain disabled until that snapshot and the operation copy are current. Local load SHALL preserve all effect-local V1 parameters and allow the effect-specific motion edits above and show sensitivity and renderer smoothing as noneditable values truthfully.

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

#### Scenario: Save a motion-tuned preset
- **WHEN** the operator loads a saved V1 recipe, edits its supported motion values and explicitly saves a new named preset
- **THEN** the new preset and its generated preview retain the complete edited recipe, including unchanged sensitivity and smoothing
- **AND** earlier saved presets remain byte-for-byte unchanged across reload while no source input, calibration, admission or lighting operation starts
