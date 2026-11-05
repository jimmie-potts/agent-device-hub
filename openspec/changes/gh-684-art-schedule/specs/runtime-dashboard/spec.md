## ADDED Requirements

### Requirement: Art rhythm controls live in Automation
The dashboard SHALL expose the saved art policy, its explicit enable/disable action, waking hours and host zone, selected surfaces, six/seven/eight appearances, ambient behavior, generation and source-use controls within the existing Automation workspace. The page SHALL distinguish a draft from the saved revision, preserve edits on validation errors, reject stale writes and never retry a lost mutation. Read-only or disconnected clients SHALL not change policy. Controls SHALL remain keyboard-operable and readable at 320, 390 and desktop widths without moving active Home controls.

#### Scenario: An owner edits the rhythm on a phone
- **WHEN** a control user changes waking hours and count at 390px using the keyboard, saves and explicitly enables the policy
- **THEN** the saved values and next eligible opportunity read back, focus remains usable and no browser-side schedule or device-mode command starts

#### Scenario: Another tab changes the policy
- **WHEN** a draft's captured revision is no longer current
- **THEN** saving reports a conflict and preserves the draft for review instead of silently overwriting the newer policy

### Requirement: Forecast labels bind to actual visible art
The Art frontend SHALL display a deterministic forecast notice only beside the exact artwork/composition it currently decoded and visibly presents for that opportunity. The label SHALL say forecast, preserve chance versus likely meaning, identify its time interval and make source freshness available. It SHALL remain separate from the decorative caption and palette. Loading, an identity mismatch, hidden art, replacement, expired or unavailable notice evidence SHALL show no current factual label. Manual Gallery selection and Home layout pin/dismiss behavior SHALL remain authoritative.

#### Scenario: A stale decode finishes after a new selection
- **WHEN** a forecast opportunity changes while an older rendition is still decoding
- **THEN** neither the obsolete art nor its forecast label replaces the new selection, and no factual label appears before its matching image is visible

#### Scenario: A forecast expires while its image remains
- **WHEN** the notice reaches its stale time while the decorative artwork is still visible
- **THEN** the factual label clears or explicitly reports unavailable evidence while the saved image remains decorative

### Requirement: The art schedule explains partial and suppressed outcomes
The Automation page SHALL separately show why an opportunity was suppressed and the current evidence for its generation, preparation, browser selection and each display command. Missing/stale operation state SHALL be labeled as such. No summary SHALL convert accepted requests into successful or physically observed art. An unsupported calendar source SHALL be visibly unavailable rather than presented as enabled meeting support.

#### Scenario: One display is unavailable
- **WHEN** an opportunity selects browser art and one display is unavailable while another is still awaiting completion
- **THEN** the page shows each result independently, names the unavailable surface and avoids a group success label
