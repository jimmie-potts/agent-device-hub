## ADDED Requirements

### Requirement: Explicit reactive recipe drafts
The shared Nanoleaf Wall interface SHALL offer five immutable version-one built-in Music recipes, one per existing reactive effect, with an unsaved palette/intensity draft and a choice of example Lines or NL22 geometry. Draft edits SHALL remain local. Audio SHALL expose a contextual link to this existing interface. This increment SHALL preserve the separate requirement for custom reactive-preset persistence.

#### Scenario: Five effects are available without light admission
- **WHEN** an operator opens the preview within the Wall page
- **THEN** all five built-ins and their palette/intensity controls are available without starting capture, selecting devices or sending a command

#### Scenario: Draft edits remain unsaved
- **WHEN** the operator edits a draft and reloads the page
- **THEN** the page returns to its built-in default without writing a preset, configuration or operation

### Requirement: Bounded synthetic Music preparation
An explicit authenticated content read SHALL prepare twenty finite RGB samples for fixed example geometry with at most twelve zones, using the existing canonical Music renderer. It SHALL accept only a closed version-one request selecting a supported built-in, palette, intensity and example model, bound decoded request bytes to 2 KiB and encoded response bytes to 16 KiB, and return a versioned document identifying the recipe, synthetic stimulus, model, offsets and RGB values. Preparation SHALL read no configured layout, device, database, file, capture stream or clock and SHALL create no device work, state update, outbox message or ticket. Errors SHALL use registered meanings and fixed safe text.

#### Scenario: Canonical RGB for every effect and model
- **WHEN** each built-in is explicitly previewed on both supported example models
- **THEN** each sample agrees with the canonical renderer's static RGB output and the response remains within its declared limits

#### Scenario: Unsupported or oversized request
- **WHEN** a request contains an unsupported version, effect, model, field or parameter, or exceeds the request bound
- **THEN** preparation refuses it as invalid-request without external reads or changes

#### Scenario: Cancelled read
- **WHEN** the content request is cancelled before preparation completes
- **THEN** no preview is returned as success and no device or stored state is changed

### Requirement: Truthful explicit synthetic preview
The preview SHALL visibly identify generated input, example geometry and an unsaved draft, and SHALL make no live, calibrated, configured-layout or physical-timing claim. Only an explicit Preview action SHALL request preparation. Scrubbing SHALL remain browser-local. Edits, disconnect and unmount SHALL invalidate prior results, and delayed or malformed content SHALL not replace a newer draft. Reconnect or failure SHALL require explicit retry. Keyboard, phone and accessibility behavior SHALL remain supported, including read-only users.

#### Scenario: Passive page lifecycle
- **WHEN** the page opens, reloads, reconnects or changes its local sample slider
- **THEN** it sends no preview request or command automatically

#### Scenario: Edit during a delayed request
- **WHEN** a requested preview is delayed and the operator edits its draft
- **THEN** the late response is discarded, the prior result stays cleared and another explicit Preview is needed after settlement

#### Scenario: Connection loss or unmount
- **WHEN** a preview read is pending as the page disconnects or unmounts
- **THEN** its later success or failure cannot restore a preview in the retired page lifetime

#### Scenario: Read-only keyboard and phone use
- **WHEN** a read-only operator uses the preview by keyboard at a phone viewport
- **THEN** controls remain reachable, generated-input labels remain clear and the result changes only through explicit preview or local scrubbing
