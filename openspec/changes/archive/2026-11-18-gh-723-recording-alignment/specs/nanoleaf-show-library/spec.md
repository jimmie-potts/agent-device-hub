## ADDED Requirements

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
