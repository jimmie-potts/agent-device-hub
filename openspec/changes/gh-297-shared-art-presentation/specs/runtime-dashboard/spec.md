## ADDED Requirements

### Requirement: The art widget follows authoritative browser selection
The widget SHALL acquire the selected existing browser composition through authenticated content, including when it is absent from the recent page. It SHALL finish decoding before replacing visible art or publishing its palette. Pending, stale, unavailable, deleted or superseded selections SHALL retain the established explicit feedback and obsolete-load protections. Gallery browsing SHALL remain a local choice and SHALL NOT silently rewrite authoritative selection or command a device.

#### Scenario: A selected older composition loads slowly
- **WHEN** authoritative state selects an older saved composition and its image is still loading
- **THEN** the widget retains the prior visible art and palette until the selected image is decoded, with no provider call

#### Scenario: Selection changes before decoding finishes
- **WHEN** a newer authoritative selection arrives before the old image finishes decoding
- **THEN** the old result cannot replace the newer choice or its presented palette

