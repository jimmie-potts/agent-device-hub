## Purpose

Let one operator privately prepare and retain decorative Nanoleaf cue plans, inspect their timing and colors, and edit new versions without controlling playback or lights.

## ADDED Requirements

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

### Requirement: Explicit accessible authoring

The module page SHALL offer deterministic starter drafts, cue timing/effect/palette/intensity editing, explicit saves and version selection through the existing SDK frontend. Saved-state changes SHALL require current control authority and live catalog/operation evidence. Drafts SHALL remain visible after refusals or uncertain results, without automatic resend. Read-only users SHALL be able to inspect saved versions. Keyboard, small-screen and accessibility checks SHALL cover this workflow, including stale and conflict states. This covers the offline editing portion of #723 AC5.

#### Scenario: Start and save a draft
- **WHEN** the operator opens the page, chooses a starter and edits cues
- **THEN** no saved state or device changes until the explicit save, and the confirmed version becomes independently selectable

#### Scenario: Unavailable authority or uncertain result
- **WHEN** the connection/catalog is stale, control is absent, or a save result is uncertain
- **THEN** mutation controls remain disabled as required by the shared tracked-command state, the draft is retained, and reconnect or reload sends no save
