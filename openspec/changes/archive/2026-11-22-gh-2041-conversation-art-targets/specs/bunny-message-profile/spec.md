## ADDED Requirements

### Requirement: Configured art destinations and guarded show requests

The core SHALL expose its configured art display inventory through SDK state. A guarded show request SHALL bind each selected physical destination to its configured target, device kind, configuration revision and generation epoch. The core SHALL validate the binding before sending device work. The existing unguarded command SHALL keep its released semantics.

#### Scenario: A configured routing ID differs from the artwork's kind

- **WHEN** the artwork has a usable Pixoo rendition and the configured Pixoo has a distinct routing ID
- **THEN** the approved request carries that routing ID and its device binding, and each resulting operation names the intended target

#### Scenario: A display was replaced while an approval was open

- **WHEN** a guarded target's current identity differs from its approved binding or is no longer available
- **THEN** the core refuses the stale target before presentation to the replacement and returns the applicable registered error
