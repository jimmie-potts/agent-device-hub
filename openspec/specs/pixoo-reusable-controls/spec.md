# pixoo-reusable-controls Specification

## Purpose

Provide reusable Pixoo controls and deliberate media selection throughout the current B.U.N.N.Y. runtime, preserving owner state, private media and truthful command outcomes.

## Requirements

### Requirement: One display card across runtime surfaces
The runtime SHALL reuse the module-owned Pixoo card on Home, its device page and Player. Display/Content tabs SHALL retain mounted artwork and support keyboard and reduced motion. Advanced pages SHALL remain reachable; the card SHALL expose no Activity tab or layout switch.

#### Scenario: Inspect the card
- **WHEN** an operator opens a supported surface and changes tabs
- **THEN** the artwork remains mounted, controls fit phone widths and no device command is sent

### Requirement: Bounded animated media selection
The picker SHALL search and page through current owner media and animate only bounded visible previews. Hidden previews SHALL release owned frames. Reduced motion and pause SHALL provide still thumbnails. Selection SHALL remain distinct from explicit playback.

#### Scenario: Browse without interrupting playback
- **WHEN** the operator searches, changes pages or selects media
- **THEN** current playback is unchanged until an explicit guarded Play command

### Requirement: Durable playlist drafts and creation
The editor SHALL create and name populated playlists, add selected media across pages, reorder/remove items and explicitly save. Invalid, oversized, stale, read-only and unconfirmed edits SHALL not overwrite owner state or retry. The existing create operation SHALL optionally accept a requested playlist identity and initial items, commit them atomically and preserve legacy empty creation.

#### Scenario: Create a populated playlist
- **WHEN** the operator submits a valid name and referenced items with an unused playlist identity
- **THEN** the owner saves the playlist and items together without changing playback

#### Scenario: Refuse invalid creation
- **WHEN** an initial item is invalid or the requested identity already exists
- **THEN** creation fails without an empty or partially populated playlist

### Requirement: Explicit playback and looping
The card SHALL bind playlist play, skip and pause/resume to existing tracked commands. New playlists SHALL repeat. Existing non-repeating playlists SHALL require an explicit repeat save before play. Saved edits SHALL leave the active checkpoint unchanged until an explicit restart. Reload and reconnect SHALL never replay commands.

#### Scenario: Save while playing
- **WHEN** the operator saves an edited playlist
- **THEN** its active session continues unchanged and explicit restart can apply the saved revision

#### Scenario: Lost reply
- **WHEN** a mutation reply or completion is uncertain
- **THEN** the UI retains the request identity and locks affected writes without retry or inferred success

#### Scenario: Recover inspection after a lost stream
- **WHEN** the connection drops and the replacement snapshot is still pending
- **THEN** controls stay locked and hidden previews release their frames until fresh owner records and the passive player read return, without sending a command
