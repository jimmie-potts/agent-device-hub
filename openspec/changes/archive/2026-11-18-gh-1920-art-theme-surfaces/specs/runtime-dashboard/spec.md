## MODIFIED Requirements

### Requirement: Owner-controlled art theme
Settings SHALL offer Follow artwork, Lock current colors and Restore default as browser-local presentation controls. A successful save SHALL preserve the chosen mode and locked palette or locked default across reload and restart. Restore default SHALL remain effective until an explicit later choice. Storage failure or invalid saved input SHALL leave a usable prior/default theme with truthful save status and no automatic write retry. An applied art theme SHALL take only its hue and tint strength from the artwork's palette: every decorative role SHALL keep a fixed lightness step in light and dark appearance, so the page background, inset, panel and raised surfaces stay distinguishable for every accepted palette. The tint SHALL come from the first palette color that has a hue and does not read as black; a near-black color with a hue SHALL tint only when no lighter one has a hue, and a palette with no hue SHALL give neutral surfaces.

#### Scenario: Lock and restore
- **WHEN** the owner locks displayed colors and another artwork appears, then the browser or runtime restarts
- **THEN** the locked colors remain, and Restore default returns to Quiet glass without changing layout or spending provider allowance

#### Scenario: Lock the default
- **WHEN** no valid art theme is applied and the owner locks current colors
- **THEN** the default remains locked across artwork arrivals and restart without inventing a palette

#### Scenario: Contrast and fixed meanings
- **WHEN** contrasting art palettes are applied in light and dark appearance across ordinary, warning, error, pending, disabled and focused controls
- **THEN** only allowed decorative roles change, text and focus remain readable, semantic/device colors retain their meanings and control geometry stays fixed

#### Scenario: Browser storage fails
- **WHEN** saving an explicit preference fails or another tab supplies invalid preference data
- **THEN** the page keeps a valid theme and clearly reports that the attempted preference was not saved or could not be read

#### Scenario: Dark or colorless artwork
- **WHEN** the visible artwork's palette starts with black or grey, or holds no colored entry, in light and dark appearance
- **THEN** cards, raised controls, inset areas and the rail remain distinguishable from the page background, and the tint comes from the first colored entry that does not read as black, or is neutral when the palette has no hue
