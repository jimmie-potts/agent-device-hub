## ADDED Requirements

### Requirement: The gallery shows saved art now
The gallery SHALL offer Show now for the selected artwork and on each saved artwork card, with surface choices for the browser and every configured art display, all chosen by default. It SHALL send one `art-show` command through the shell's tracked command attempt with only the chosen surfaces that artwork has a usable composition for, and disable the control for an artwork outside the current art record, without control authority, while records are stale or while a previous show's attempt is unresolved. It SHALL report each sent surface from the core's operation records: preparation and appearance for a display and selection for the browser, presenting a transmitted moment as sent rather than displayed, a browser selection as saved rather than rendered, and an unsent surface as not sent with a pointer to Recent attempts. Show now SHALL create no art and start no provider call; "Create art" remains the only generation control, and scheduled generation still selects no presentation.

#### Scenario: The owner shows one artwork
- **WHEN** the owner presses Show now on a saved artwork with all surfaces chosen
- **THEN** one `art-show` command names that artwork and the surfaces it has compositions for
- **AND** each surface's status follows its own operation records without claiming the panel showed the art

#### Scenario: Older art cannot be shown
- **WHEN** the gallery page shows an artwork that is not in the current art record
- **THEN** its Show now control is disabled and explains that only the most recent saved art can be shown now
