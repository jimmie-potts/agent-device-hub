# Nanoleaf show library Specification

## Purpose

Let one operator privately prepare and retain decorative Nanoleaf cue plans, inspect their timing and colors, and edit new versions without controlling playback or lights.

## Requirements

### Requirement: Immutable bounded decorative versions

The library SHALL accept named decorative shows and named versions containing only bounded version-one Nanoleaf timelines. Each explicit save SHALL create a new immutable version guarded by the current show version, with zero identifying creation. It SHALL freeze explicit recipes and retain earlier versions across restart. It SHALL allow at most 32 shows, 256 total versions and 128 KiB per encoded version, refusing capacity without deleting existing data. Timeline validation SHALL preserve the existing limits and refuse unknown fields, invalid names, unsupported recipes, overlapping cues and unresolved favorites. This covers the offline portions of #723 AC1 and AC2.

#### Scenario: Edit a saved starter
- **WHEN** the operator saves a starter, edits its colors and saves against its current version
- **THEN** a new named version is retained and the earlier version reads exactly as before, including after restart

#### Scenario: Conflicting or invalid save
- **WHEN** a save names an old expected version, an invalid timeline or a full library
- **THEN** the request is refused with the registry error for that cause and no head, version or successful outcome changes

### Requirement: Metadata-only atomic outcomes and recovery

Saving SHALL commit the show version, current head, catalog state and matching metadata outcome atomically. Acceptance SHALL remain distinct from completion. Command replay, retries and implicit resubmission SHALL NOT occur on reconnect, restart, read or page load. Saves SHALL NOT alter device configuration, modes, device outcomes, control journals, writer scheduling or physical output. Authored content SHALL remain within the existing private authenticated module boundary and SHALL NOT enter diagnostics. This covers #723 AC1 and AC5 persistence and recovery.

#### Scenario: Commit failure or restart after commit
- **WHEN** a save transaction fails, or the module restarts after a committed save before publication completes
- **THEN** failure leaves no partial save, and restart republishes only the committed catalog and outcome without creating another version or issuing a device command

#### Scenario: Metadata save while devices are configured
- **WHEN** a valid show save completes
- **THEN** its outcome reports the observed library change, while device revisions, last outcomes and writer queues remain unchanged

### Requirement: Bounded read-only catalog and storyboard

The module SHALL expose a bounded authenticated catalog and explicit immutable version reads. Reads SHALL refuse malformed identities, unknown versions and invalid stored data without modifying that data. The editor SHALL label its preview a decorative cue storyboard showing intervals, gaps, palettes, intensity and effect names. Preview SHALL send no command and SHALL make no exact-frame, recording-alignment or audible-synchronization claim. This covers the offline preview portion of #723 AC1 and AC5.

#### Scenario: Inspect a saved version
- **WHEN** the operator selects a saved version and inspects its cue timing, including gaps and the end
- **THEN** the selected immutable values are shown without a timer, lighting instruction, playback command or storage mutation

#### Scenario: Damaged or missing version
- **WHEN** a selected version cannot be read or fails validation
- **THEN** the page reports it unavailable, never substitutes another version as the requested evidence and preserves stored bytes

### Requirement: Explicit authoring

The module page SHALL offer deterministic starter drafts, cue timing/effect/palette/intensity editing, explicit saves and version selection through the existing SDK frontend. Saved-state changes SHALL require current control authority and live catalog/operation evidence. Drafts SHALL remain visible after refusals or uncertain results, without automatic resend. Read-only users SHALL be able to inspect saved versions. Keyboard and small-screen checks SHALL cover this workflow, including stale and conflict states. This covers the offline editing portion of #723 AC5.

#### Scenario: Start and save a draft
- **WHEN** the operator opens the page, chooses a starter and edits cues
- **THEN** no saved state or device changes until the explicit save, and the confirmed version becomes independently selectable

#### Scenario: Unavailable authority or uncertain result
- **WHEN** the connection/catalog is stale, control is absent, or a save result is uncertain
- **THEN** mutation controls remain disabled as required by the shared tracked-command state, the draft is retained, and reconnect or reload sends no save

### Requirement: Immutable measured shows

The show library SHALL let the operator prepare a bounded cue plan from the existing live Music measurements and save it as an immutable show version with its scoped library item and analysis provenance. Preparation SHALL use fresh associated Music position, SHALL discard samples outside the bound item and capture generation, and SHALL activate neither capture nor lighting. It SHALL keep raw audio outside the show library. The operator SHALL be able to preview and edit the proposed cues before explicitly saving.

#### Scenario: Prepare and save a measured show

- **WHEN** Music measurements and playback observations identify the same supported item throughout a bounded preparation
- **THEN** the operator can preview, edit, and save a measured show version without activating a light
- **AND** opening the version after restart restores its item association, provenance, and authored cues

#### Scenario: Playback changes during preparation

- **WHEN** the scoped item or capture generation changes during a preparation
- **THEN** the preparation does not mix samples across those boundaries

#### Scenario: Submitted analysis provenance was not prepared

- **WHEN** a save claims measured analysis that the module did not prepare and that differs from the prior saved version's analysis
- **THEN** the save is refused while the draft remains available to the operator

#### Scenario: Unmarked playback jump during measurement

- **WHEN** consecutive observations for the same item disagree about playback progress beyond the supported clock uncertainty
- **THEN** the library discards the unconfirmed measurement windows

### Requirement: Explicit AI authoring for music shows

The show library SHALL let an authenticated controller explicitly request one Claude draft using a style request, the current Music title and artist, and either qualified derived analysis or a selected generic sequence. The request SHALL send no audio, scoped item identifiers, device details or credentials in its model input.

#### Scenario: Qualified measurements bound a draft

- **WHEN** the controller selects the measured excerpt and requests generation
- **THEN** a generated plan is available for editing only if each cue uses supported effects and valid measured span boundaries
- **AND** the editor identifies the result as a measured excerpt and displays the provider route and accounted cost

#### Scenario: Missing or inadequate measurement

- **WHEN** the selected measured excerpt cannot be qualified
- **THEN** the request is refused without dispatch
- **AND** the controller can explicitly request a generic sequence against fresh title and artist metadata even without a position reading
- **AND** a generic result is labeled as having no measured alignment

#### Scenario: Invalid or interrupted result

- **WHEN** Claude returns malformed or unsupported content, a sent call becomes uncertain, or the controller requests cancellation
- **THEN** no earlier edits, saved shows or favorites are changed
- **AND** the provider is not called again for that request

#### Scenario: A lost Cancel reply stays with its draft

- **WHEN** the controller loses the reply to a Cancel attempt for one generation
- **THEN** the browser keeps that generation's duplicate fence across reload
- **AND** the controller can cancel a different current generation
- **AND** no prior request is sent again or its spending reservation released

#### Scenario: Separate Music allowance

- **WHEN** a request would exceed the Music ledger's available USD 3 daily or USD 20 monthly allowance
- **THEN** it is refused before dispatch
- **AND** admission reserves against the higher supported regional rate
- **AND** an uncertain sent attempt keeps its exposure charged against the Music allowance

#### Scenario: Reopen a paid draft

- **WHEN** the browser reloads after a successful generation
- **THEN** the operator can explicitly reopen the latest successful draft
- **AND** the read sends no provider request

#### Scenario: Recover a transient settlement failure

- **WHEN** the owner has a result and its local settlement write temporarily fails
- **THEN** it retries only the local transaction, keeping the original spending record and attempt identity
- **AND** a recovered settlement unblocks new explicit requests

#### Scenario: Preview, save and play

- **WHEN** the controller receives and edits a generated preview
- **THEN** the preview creates no saved show or device command
- **AND** only an explicit save creates an immutable revision with generation provenance
- **AND** separately authorized playback uses that saved revision without accessing Claude
